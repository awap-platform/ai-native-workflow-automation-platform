"""gRPC transport for the Copilot service (issue #291).

The service is generated from `contracts/proto/ai/v1/copilot.proto`. REST remains available and a
parity test pins both transports to the same envelope. Metadata carries the caller's security
context, correlation id and idempotency key; the gRPC deadline is enforced with `asyncio.wait_for`.
"""

from __future__ import annotations

import asyncio
from concurrent import futures
from typing import NoReturn

import grpc
from google.protobuf import json_format
from google.protobuf.json_format import MessageToDict

from ai.v1 import copilot_pb2, copilot_pb2_grpc
from app.copilot.agent import CopilotAgent
from app.copilot.models import CopilotRequest, SecurityContext

TENANT_HEADER = "x-tenant-id"
USER_HEADER = "x-user-id"
ROLE_HEADER = "x-user-role"
PERMISSIONS_HEADER = "x-user-permissions"
SERVICE_TOKEN_HEADER = "x-ai-service-token"
CORRELATION_HEADER = "x-correlation-id"
IDEMPOTENCY_HEADER = "idempotency-key"
ERROR_CODE_HEADER = "ai-error-code"
ERROR_RETRYABLE_HEADER = "ai-error-retryable"

MAX_MESSAGE_CHARS = 8_000
MAX_GRPC_MESSAGE_BYTES = 1_048_576


def _metadata(context: grpc.ServicerContext) -> dict[str, str]:
    return {key.lower(): str(value) for key, value in context.invocation_metadata()}


def _abort(
    context: grpc.ServicerContext,
    status: grpc.StatusCode,
    code: str,
    message: str,
    retryable: bool = False,
) -> NoReturn:
    context.set_trailing_metadata(
        ((ERROR_CODE_HEADER, code), (ERROR_RETRYABLE_HEADER, "true" if retryable else "false"))
    )
    context.abort(status, message)


class CopilotServicer(copilot_pb2_grpc.CopilotServiceServicer):
    """Thin typed adapter; all behaviour stays in the shared `CopilotAgent`."""

    def __init__(self, agent: CopilotAgent, service_token: str | None = None) -> None:
        self.agent = agent
        self.service_token = service_token or None

    def Chat(  # noqa: N802 - generated service method name
        self, request: copilot_pb2.CopilotRequest, context: grpc.ServicerContext
    ) -> copilot_pb2.CopilotResponse:
        metadata = _metadata(context)
        security = self._security(request, metadata, context)
        self._validate(request, context)

        remaining = context.time_remaining()
        if request.deadline_ms > 0:
            requested = request.deadline_ms / 1_000.0
            remaining = requested if remaining is None else min(remaining, requested)
        if remaining is not None and remaining <= 0:
            _abort(
                context,
                grpc.StatusCode.DEADLINE_EXCEEDED,
                "DEADLINE_EXCEEDED",
                "The Copilot deadline expired before the request started.",
                retryable=True,
            )

        copilot_request = CopilotRequest(
            message=request.message,
            action=request.action if request.HasField("action") else None,
            context=MessageToDict(request.context, preserving_proto_field_name=True),
            idempotency_key=(
                request.idempotency_key
                if request.HasField("idempotency_key")
                else metadata.get(IDEMPOTENCY_HEADER)
            ),
            confirm_high_risk=request.confirm_high_risk,
        )
        try:
            if remaining is None:
                response = asyncio.run(self.agent.run(copilot_request, security))
            else:
                response = asyncio.run(
                    asyncio.wait_for(self.agent.run(copilot_request, security), timeout=remaining)
                )
        except TimeoutError:
            _abort(
                context,
                grpc.StatusCode.DEADLINE_EXCEEDED,
                "DEADLINE_EXCEEDED",
                "The Copilot deadline expired while the agent was running.",
                retryable=True,
            )
        except Exception as ex:  # noqa: BLE001 - any agent failure becomes a typed gRPC error
            _abort(
                context,
                grpc.StatusCode.INTERNAL,
                "INTERNAL",
                f"{type(ex).__name__}: {ex}",
            )

        proto = copilot_pb2.CopilotResponse()
        json_format.ParseDict(
            response.model_dump(mode="json", exclude_none=True),
            proto,
            ignore_unknown_fields=False,
        )
        return proto

    def _security(
        self,
        request: copilot_pb2.CopilotRequest,
        metadata: dict[str, str],
        context: grpc.ServicerContext,
    ) -> SecurityContext:
        if self.service_token and metadata.get(SERVICE_TOKEN_HEADER) != self.service_token:
            _abort(
                context,
                grpc.StatusCode.UNAUTHENTICATED,
                "UNAUTHENTICATED",
                "Invalid AI service token.",
            )
        tenant_id = metadata.get(TENANT_HEADER, "")
        user_id = metadata.get(USER_HEADER, "")
        role = metadata.get(ROLE_HEADER, "")
        if not tenant_id or not user_id or not role:
            _abort(
                context,
                grpc.StatusCode.UNAUTHENTICATED,
                "UNAUTHENTICATED",
                "Authenticated security context is required.",
            )
        if request.security.tenant_id and request.security.tenant_id != tenant_id:
            _abort(
                context,
                grpc.StatusCode.PERMISSION_DENIED,
                "FORBIDDEN",
                "The request tenant does not match the authenticated tenant.",
            )
        return SecurityContext(
            tenant_id=tenant_id,
            user_id=user_id,
            role=role,
            permissions=[
                permission
                for permission in metadata.get(PERMISSIONS_HEADER, "").split(",")
                if permission
            ],
            correlation_id=metadata.get(CORRELATION_HEADER) or request.security.correlation_id,
            access_token=request.security.access_token or None,
        )

    @staticmethod
    def _validate(request: copilot_pb2.CopilotRequest, context: grpc.ServicerContext) -> None:
        if not request.message.strip():
            _abort(
                context,
                grpc.StatusCode.INVALID_ARGUMENT,
                "INVALID_ARGUMENT",
                "message is required.",
            )
        if len(request.message) > MAX_MESSAGE_CHARS:
            _abort(
                context,
                grpc.StatusCode.INVALID_ARGUMENT,
                "INVALID_ARGUMENT",
                f"message exceeds the {MAX_MESSAGE_CHARS}-character limit.",
            )


def build_server(
    agent: CopilotAgent,
    *,
    host: str = "0.0.0.0",
    port: int = 0,
    service_token: str | None = None,
    max_workers: int = 8,
) -> tuple[grpc.Server, int]:
    """Build (but do not start) the Copilot gRPC server and return the bound port."""
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=max_workers),
        options=(
            ("grpc.max_receive_message_length", MAX_GRPC_MESSAGE_BYTES),
            ("grpc.max_send_message_length", MAX_GRPC_MESSAGE_BYTES),
        ),
    )
    copilot_pb2_grpc.add_CopilotServiceServicer_to_server(
        CopilotServicer(agent, service_token), server
    )
    bound = int(server.add_insecure_port(f"{host}:{port}"))
    return server, bound

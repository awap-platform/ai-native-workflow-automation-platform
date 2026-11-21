"""gRPC/protobuf contract and REST-parity tests (issue #291)."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator

import grpc
import pytest
from google.protobuf import json_format
from google.protobuf.json_format import MessageToDict

from ai.v1 import copilot_pb2, copilot_pb2_grpc
from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.models import CopilotAction, CopilotRequest, CopilotResponse, SecurityContext
from app.copilot.tools import ToolRegistry
from app.grpc_server import build_server

TENANT = "00000000-0000-0000-0000-000000000001"
OTHER_TENANT = "00000000-0000-0000-0000-000000000099"
USER = "00000000-0000-0000-0000-000000000002"
TOKEN = "service-secret"
METADATA = (
    ("x-tenant-id", TENANT),
    ("x-user-id", USER),
    ("x-user-role", "TENANT_ADMIN"),
    ("x-user-permissions", "INSTANCE_READ,INSTANCE_MANAGE"),
    ("x-correlation-id", "corr-grpc"),
    ("idempotency-key", "idem-grpc"),
    ("x-ai-service-token", TOKEN),
)


class FakeClient:
    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        if name == "query_tasks":
            return [{"id": "task-1", "title": "Approve leave", "status": "OPEN"}]
        return {"fullName": "Ada"}


class SlowAgent(CopilotAgent):
    async def run(self, request: CopilotRequest, security: SecurityContext):  # type: ignore[override]
        await asyncio.sleep(5)
        return await super().run(request, security)


def agent(slow: bool = False) -> CopilotAgent:
    cls = SlowAgent if slow else CopilotAgent
    return cls(
        tools=ToolRegistry(FakeClient()),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
    )


def request(
    message: str = "hello", tenant: str = TENANT, deadline_ms: int = 0
) -> copilot_pb2.CopilotRequest:
    proto = copilot_pb2.CopilotRequest(message=message, action="chat", deadline_ms=deadline_ms)
    proto.security.tenant_id = tenant
    proto.security.user_id = USER
    proto.security.role = "TENANT_ADMIN"
    json_format.ParseDict({"team": "ops"}, proto.context)
    return proto


@pytest.fixture()
def stub() -> Iterator[tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel]]:
    server, port = build_server(agent(), host="127.0.0.1", port=0, service_token=TOKEN)
    server.start()
    channel = grpc.insecure_channel(f"127.0.0.1:{port}")
    try:
        yield copilot_pb2_grpc.CopilotServiceStub(channel), channel
    finally:
        channel.close()
        server.stop(grace=0)


@pytest.fixture()
def slow_stub() -> Iterator[tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel]]:
    server, port = build_server(agent(slow=True), host="127.0.0.1", port=0, service_token=TOKEN)
    server.start()
    channel = grpc.insecure_channel(f"127.0.0.1:{port}")
    try:
        yield copilot_pb2_grpc.CopilotServiceStub(channel), channel
    finally:
        channel.close()
        server.stop(grace=0)


def test_grpc_chat_returns_the_same_envelope_as_rest(
    stub: tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel],
) -> None:
    service, _channel = stub
    rest_request = CopilotRequest(
        message="hello", action=CopilotAction.CHAT, idempotency_key="idem-grpc"
    )
    rest_security = SecurityContext(
        tenant_id=TENANT,
        user_id=USER,
        role="TENANT_ADMIN",
        permissions=["INSTANCE_READ", "INSTANCE_MANAGE"],
        correlation_id="corr-grpc",
    )
    rest_full = asyncio.run(agent().run(rest_request, rest_security)).model_dump(
        mode="json", exclude_none=True
    )
    proto_fields = set(copilot_pb2.CopilotResponse.DESCRIPTOR.fields_by_name)
    rest = {key: value for key, value in rest_full.items() if key in proto_fields}

    response = service.Chat(request(), metadata=METADATA)

    grpc_dict = MessageToDict(response, preserving_proto_field_name=True)
    parsed_rest = copilot_pb2.CopilotResponse()
    json_format.ParseDict(rest, parsed_rest)
    assert grpc_dict == MessageToDict(parsed_rest, preserving_proto_field_name=True)
    assert response.answer == rest["answer"]
    assert response.prompt_hash == rest["prompt_hash"]
    assert response.correlation_id == "corr-grpc"
    assert response.idempotency_key == "idem-grpc"


def test_tool_calls_and_results_round_trip_with_exact_types(
    stub: tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel],
) -> None:
    service, _channel = stub

    response = service.Chat(
        copilot_pb2.CopilotRequest(message="my tasks", action="query_tasks"), metadata=METADATA
    )

    names = [call.name for call in response.tool_calls]
    assert names == ["query_tasks", "audit_decision"]
    result = MessageToDict(response.tool_calls[0].result, preserving_proto_field_name=True)
    assert result == [{"id": "task-1", "status": "OPEN", "title": "Approve leave"}]
    assert response.tool_calls[0].ok is True


def test_deadline_is_honored(
    slow_stub: tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel],
) -> None:
    service, _channel = slow_stub

    with pytest.raises(grpc.RpcError) as caught:
        service.Chat(request(deadline_ms=100), metadata=METADATA, timeout=5)

    assert caught.value.code() == grpc.StatusCode.DEADLINE_EXCEEDED
    assert dict(caught.value.trailing_metadata())["ai-error-code"] == "DEADLINE_EXCEEDED"


def test_an_invalid_service_token_is_rejected(
    stub: tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel],
) -> None:
    service, _channel = stub
    without_token = tuple(item for item in METADATA if item[0] != "x-ai-service-token")

    with pytest.raises(grpc.RpcError) as caught:
        service.Chat(request(), metadata=without_token)

    assert caught.value.code() == grpc.StatusCode.UNAUTHENTICATED
    assert dict(caught.value.trailing_metadata())["ai-error-code"] == "UNAUTHENTICATED"


def test_missing_security_context_is_rejected(
    stub: tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel],
) -> None:
    service, _channel = stub
    only_token = (("x-ai-service-token", TOKEN),)

    with pytest.raises(grpc.RpcError) as caught:
        service.Chat(request(), metadata=only_token)

    assert caught.value.code() == grpc.StatusCode.UNAUTHENTICATED


def test_cross_tenant_requests_are_rejected(
    stub: tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel],
) -> None:
    service, _channel = stub

    with pytest.raises(grpc.RpcError) as caught:
        service.Chat(request(tenant=OTHER_TENANT), metadata=METADATA)

    assert caught.value.code() == grpc.StatusCode.PERMISSION_DENIED
    assert dict(caught.value.trailing_metadata())["ai-error-code"] == "FORBIDDEN"


def test_blank_and_oversized_messages_are_rejected(
    stub: tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel],
) -> None:
    service, _channel = stub

    for message in ("   ", "x" * 8_001):
        invalid = copilot_pb2.CopilotRequest(message=message, action="chat")
        with pytest.raises(grpc.RpcError) as caught:
            service.Chat(invalid, metadata=METADATA)
        assert caught.value.code() == grpc.StatusCode.INVALID_ARGUMENT
        assert dict(caught.value.trailing_metadata())["ai-error-code"] == "INVALID_ARGUMENT"


def test_malformed_payload_is_rejected(
    stub: tuple[copilot_pb2_grpc.CopilotServiceStub, grpc.Channel],
) -> None:
    _service, channel = stub
    raw = channel.unary_unary(
        "/ai.v1.CopilotService/Chat",
        request_serializer=lambda _value: b"\xff\xff\xff",
        response_deserializer=lambda value: value,
    )

    with pytest.raises(grpc.RpcError) as caught:
        raw(b"", metadata=METADATA, timeout=2)

    assert caught.value.code() in {grpc.StatusCode.INTERNAL, grpc.StatusCode.UNKNOWN}


def test_rest_fixture_normalizes_to_the_same_proto_projection() -> None:
    rest_full = CopilotResponse(
        answer="Found 2 results",
        action=CopilotAction.KNOWLEDGE_SEARCH,
        confidence=0.82,
        requires_human_approval=True,
        prompt_key="knowledge_search",
        prompt_version="v1",
        prompt_hash="a" * 64,
        correlation_id="corr-fixture",
        cache_hit=True,
        data=[{"title": "Policy", "score": 0.9}],
    ).model_dump(mode="json", exclude_none=True)
    proto_fields = set(copilot_pb2.CopilotResponse.DESCRIPTOR.fields_by_name)
    rest = {key: value for key, value in rest_full.items() if key in proto_fields}

    proto = copilot_pb2.CopilotResponse()
    json_format.ParseDict(rest, proto)
    round_trip = MessageToDict(proto, preserving_proto_field_name=True)

    assert round_trip["answer"] == "Found 2 results"
    assert round_trip["requires_human_approval"] is True
    assert round_trip["cache_hit"] is True
    assert round_trip["data"] == [{"title": "Policy", "score": 0.9}]

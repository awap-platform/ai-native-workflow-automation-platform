"""Tool registry with per-call permission verification.

Every state-changing copilot action goes through this registry. The backend re-verifies the same
permission from the signed security context, so a compromised prompt cannot exceed the caller's
authority (C3).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

from app.copilot.models import SecurityContext, ToolCall

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "SYSTEM_ADMIN": {
        "TENANT_MANAGE",
        "USER_MANAGE",
        "WORKFLOW_CREATE",
        "WORKFLOW_PUBLISH",
        "INSTANCE_READ",
        "INSTANCE_MANAGE",
        "TASK_APPROVE",
        "TASK_MANAGE",
        "FORM_MANAGE",
        "FILE_UPLOAD",
    },
    "TENANT_ADMIN": {
        "USER_MANAGE",
        "WORKFLOW_CREATE",
        "WORKFLOW_PUBLISH",
        "INSTANCE_READ",
        "INSTANCE_MANAGE",
        "TASK_APPROVE",
        "TASK_MANAGE",
        "FORM_MANAGE",
        "FILE_UPLOAD",
    },
    "MANAGER": {
        "WORKFLOW_CREATE",
        "INSTANCE_READ",
        "TASK_APPROVE",
        "TASK_MANAGE",
    },
    "OPERATIONS": {"INSTANCE_READ", "TASK_MANAGE", "FORM_MANAGE", "FILE_UPLOAD"},
    "EMPLOYEE": {"INSTANCE_READ", "TASK_MANAGE", "FORM_MANAGE"},
}

TOOL_PERMISSIONS: dict[str, str | None] = {
    "find_workflow": "INSTANCE_READ",
    "create_workflow_instance": "INSTANCE_MANAGE",
    "query_tasks": "TASK_MANAGE",
    "complete_task": "TASK_MANAGE",
    "assign_task": "TASK_MANAGE",
    "create_approval": "TASK_MANAGE",
    "send_notification": "INSTANCE_MANAGE",
    "search_documents": "INSTANCE_READ",
    "get_user": None,
    "audit_decision": None,
}


class ToolPermissionDenied(PermissionError):
    """Raised when the caller does not hold the tool's required permission."""


def effective_permissions(security: SecurityContext) -> set[str]:
    declared = {permission.upper() for permission in security.permissions}
    role_permissions = ROLE_PERMISSIONS.get(security.role.upper(), set())
    return declared | role_permissions


def require_permission(security: SecurityContext, tool_name: str) -> None:
    required = TOOL_PERMISSIONS.get(tool_name)
    if required is None:
        return
    if required not in effective_permissions(security):
        raise ToolPermissionDenied(
            f"Tool '{tool_name}' requires {required}; caller role is {security.role}."
        )


@dataclass
class BackendToolClient:
    """HTTP client for the backend's internal tool API."""

    base_url: str | None = None
    service_token: str | None = None
    timeout_seconds: float = 10.0
    transport: httpx.AsyncBaseTransport | None = None

    def __post_init__(self) -> None:
        self.base_url = (
            self.base_url or os.getenv("AI_BACKEND_URL", "http://localhost:8080")
        ).rstrip("/")
        self.service_token = self.service_token or os.getenv("AI_BACKEND_SERVICE_TOKEN", "")
        self.timeout_seconds = float(
            os.getenv("AI_BACKEND_TIMEOUT_SECONDS", str(self.timeout_seconds))
        )

    def _headers(self, security: SecurityContext, idempotency_key: str | None) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Tenant-Id": security.tenant_id,
            "X-User-Id": security.user_id,
            "X-User-Role": security.role,
            "X-User-Permissions": ",".join(sorted(effective_permissions(security))),
            "X-Ai-Service-Token": self.service_token,
        }
        if security.correlation_id:
            headers["X-Correlation-Id"] = security.correlation_id
        if security.access_token:
            headers["Authorization"] = f"Bearer {security.access_token}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    async def call(
        self,
        tool_name: str,
        payload: dict[str, Any],
        security: SecurityContext,
        idempotency_key: str | None = None,
    ) -> Any:
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds, transport=self.transport
        ) as client:
            response = await client.post(
                f"{self.base_url}/internal/tools/{tool_name}",
                json=payload,
                headers=self._headers(security, idempotency_key),
            )
        if response.status_code >= 400:
            detail = response.text[:500]
            raise RuntimeError(
                f"Backend tool '{tool_name}' failed with status {response.status_code}: {detail}"
            )
        if not response.content:
            return None
        return response.json()


class ToolRegistry:
    def __init__(self, client: BackendToolClient | None = None) -> None:
        self.client = client or BackendToolClient()

    async def invoke(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        security: SecurityContext,
        idempotency_key: str | None = None,
    ) -> ToolCall:
        try:
            require_permission(security, tool_name)
            result = await self.client.call(tool_name, arguments, security, idempotency_key)
            return ToolCall(name=tool_name, arguments=arguments, result=result, ok=True)
        except ToolPermissionDenied as ex:
            return ToolCall(name=tool_name, arguments=arguments, ok=False, error=str(ex))
        except Exception as ex:  # tool failure must be visible, never silently swallowed
            return ToolCall(
                name=tool_name,
                arguments=arguments,
                ok=False,
                error=f"{type(ex).__name__}: {ex}",
            )

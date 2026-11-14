"""Tool permission verification tests (C3)."""

from __future__ import annotations

import asyncio

import pytest

from app.copilot.models import SecurityContext
from app.copilot.tools import ToolPermissionDenied, ToolRegistry, require_permission


def security(role: str, permissions: list[str] | None = None) -> SecurityContext:
    return SecurityContext(
        tenant_id="00000000-0000-0000-0000-000000000001",
        user_id="00000000-0000-0000-0000-000000000002",
        role=role,
        permissions=permissions or [],
    )


def test_employee_cannot_start_a_workflow() -> None:
    with pytest.raises(ToolPermissionDenied):
        require_permission(security("EMPLOYEE"), "create_workflow_instance")


def test_tenant_admin_can_start_a_workflow() -> None:
    require_permission(security("TENANT_ADMIN"), "create_workflow_instance")


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        self.calls.append((name, payload))
        return {"ok": True}


def test_registry_returns_a_failed_tool_call_instead_of_raising() -> None:
    registry = ToolRegistry(FakeClient())  # type: ignore[arg-type]
    call = asyncio.run(
        registry.invoke("create_workflow_instance", {"workflowId": "x"}, security("EMPLOYEE"))
    )
    assert call.ok is False
    assert "requires INSTANCE_MANAGE" in (call.error or "")

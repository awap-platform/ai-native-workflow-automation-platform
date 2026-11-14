"""Fault-injection seams and a recording backend for the C5 split-brain invariant.

LangGraph owns only the agent's internal planning state. Business state lives exclusively in the
Java Workflow Engine: the agent may change it only through the audited backend tool contract. This
module makes that boundary testable:

* ``FaultyAgent`` injects a LangGraph node that throws, times out, corrupts its state or returns an
  invalid shape.
* ``RecordingBackend`` implements the exact backend tool contract and records every call, the
  idempotency store and the business rows (instances, node executions, outbox events, tasks).
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from app.copilot.agent import CopilotAgent
from app.copilot.models import SecurityContext, ToolCall

STATE_CHANGING_TOOLS = {
    "create_workflow_instance",
    "complete_task",
    "create_approval",
    "send_notification",
    "assign_task",
}


class RecordingBackend:
    """Deterministic, thread-safe stand-in for the backend tool contract."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.instances: dict[str, dict[str, Any]] = {}
        self.idempotency: dict[tuple[str, str], str] = {}
        self.node_executions: list[dict[str, Any]] = []
        self.outbox_events: list[dict[str, Any]] = []
        self.tasks: list[dict[str, Any]] = []
        self.audit_rows: list[dict[str, Any]] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail_create_before_commit = False
        self.fail_create_after_commit = False

    # ------------------------------------------------------------------ contract
    async def call(
        self,
        tool_name: str,
        payload: dict[str, Any],
        security: SecurityContext,
        idempotency_key: str | None = None,
    ) -> Any:
        with self._lock:
            self.calls.append((tool_name, dict(payload)))
        if tool_name == "find_workflow":
            return [{"id": "wf-1", "name": "Leave Request"}]
        if tool_name == "create_workflow_instance":
            return self._create_instance(payload, security, idempotency_key)
        if tool_name == "query_tasks":
            with self._lock:
                return list(self.tasks)
        if tool_name == "complete_task":
            return self._complete_task(payload, security)
        if tool_name == "create_approval":
            return self._create_task(payload, security, "APPROVAL")
        if tool_name == "assign_task":
            return self._create_task(payload, security, "ASSIGNED")
        if tool_name == "search_documents":
            return []
        if tool_name == "get_user":
            return {"fullName": "Split Brain Tester"}
        if tool_name == "audit_decision":
            with self._lock:
                self.audit_rows.append(dict(payload))
            return {"recorded": True}
        raise AssertionError(f"Unexpected tool '{tool_name}' in the split-brain test.")

    # ------------------------------------------------------------------ business writes
    def _create_instance(
        self,
        payload: dict[str, Any],
        security: SecurityContext,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        key = (security.tenant_id, idempotency_key or "")
        with self._lock:
            existing = self.idempotency.get(key)
            if existing is not None:
                return dict(self.instances[existing])
            if self.fail_create_before_commit:
                raise RuntimeError("transaction rolled back: no business row was written")
            instance_id = f"instance-{len(self.instances) + 1}"
            instance = {
                "id": instance_id,
                "state": "STARTED",
                "idempotencyKey": idempotency_key,
                "workflowId": payload.get("workflowId"),
            }
            self.instances[instance_id] = instance
            self.idempotency[key] = instance_id
            self.node_executions.append({"instanceId": instance_id, "nodeId": "start"})
            self.outbox_events.append({"instanceId": instance_id, "type": "WORKFLOW_STARTED"})
            if self.fail_create_after_commit:
                raise RuntimeError("connection lost after the engine committed the instance")
            return dict(instance)

    def _complete_task(self, payload: dict[str, Any], security: SecurityContext) -> dict[str, Any]:
        with self._lock:
            task = {
                "id": payload.get("taskId"),
                "status": "APPROVED" if payload.get("decision") == "approve" else "COMPLETED",
                "tenantId": security.tenant_id,
            }
            self.tasks.append(task)
            return task

    def _create_task(
        self, payload: dict[str, Any], security: SecurityContext, status: str
    ) -> dict[str, Any]:
        with self._lock:
            task = {
                "id": f"task-{len(self.tasks) + 1}",
                "status": status,
                "tenantId": security.tenant_id,
                "workflowInstanceId": payload.get("workflowInstanceId"),
            }
            self.tasks.append(task)
            return task

    # ------------------------------------------------------------------ assertions
    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "instances": len(self.instances),
                "node_executions": len(self.node_executions),
                "outbox_events": len(self.outbox_events),
                "tasks": len(self.tasks),
                "audit_rows": len(self.audit_rows),
            }

    def state_changing_calls(self) -> list[str]:
        with self._lock:
            return [name for name, _ in self.calls if name in STATE_CHANGING_TOOLS]

    def tool_names(self) -> list[str]:
        with self._lock:
            return [name for name, _ in self.calls]


class FaultyAgent(CopilotAgent):
    """Copilot agent whose LangGraph node misbehaves on demand.

    The fault is injected into the real graph (the subclass override is the node bound by
    ``StateGraph``), so the test exercises the production graph topology rather than a mock.
    """

    def __init__(self, mode: str, **kwargs: Any) -> None:
        self.mode = mode
        super().__init__(**kwargs)

    async def _act(self, state: dict[str, Any]) -> dict[str, Any]:
        if self.mode == "throw":
            raise RuntimeError("injected LangGraph node failure")
        if self.mode == "timeout":
            await asyncio.sleep(5)
            return state
        if self.mode == "corrupt":
            # Deliberately write bogus business-ish state into the agent graph.
            state["answer"] = None
            state["confidence"] = "not-a-number"
            state["business_state"] = {"instances": 99, "tasks": 99}
            raise RuntimeError("LangGraph state was corrupted")
        if self.mode == "invalid_shape":
            return {"answer": 12345, "action": "not-a-real-action"}
        return await super()._act(state)


def tool_call_names(tool_calls: list[ToolCall]) -> list[str]:
    return [call.name for call in tool_calls]

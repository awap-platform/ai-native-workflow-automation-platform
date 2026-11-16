"""HTTP contract tests for the copilot API."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.tools import ToolRegistry
from app.main import app


class FakeClient:
    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        if name == "query_tasks":
            return [{"id": "task-1", "title": "Approve leave", "status": "OPEN"}]
        if name == "search_documents":
            return [{"fileId": "file-1", "title": "Policy", "snippet": "Leave policy"}]
        return {"recorded": True}


HEADERS = {
    "X-Tenant-Id": "00000000-0000-0000-0000-000000000001",
    "X-User-Id": "00000000-0000-0000-0000-000000000002",
    "X-User-Role": "TENANT_ADMIN",
    "X-Correlation-Id": "corr-api",
}


def client(tools: FakeClient | None = None) -> TestClient:
    app.state.copilot_agent = CopilotAgent(
        tools=ToolRegistry(tools or FakeClient()),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
    )
    return TestClient(app)


class RecordingClient(FakeClient):
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        self.calls.append((name, payload))
        if name == "create_approval":
            return {"id": "approval-1", "status": "OPEN"}
        return {"recorded": True}

    def approval_count(self) -> int:
        return sum(1 for name, _ in self.calls if name == "create_approval")


def test_chat_returns_the_versioned_copilot_envelope() -> None:
    response = client().post("/api/v1/copilot/chat", json={"message": "hello"}, headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["prompt_key"] == "chat"
    assert body["prompt_version"] == "v1"
    assert len(body["prompt_hash"]) == 64
    assert body["correlation_id"] == "corr-api"
    assert body["action"] == "chat"


def test_task_query_route_returns_tasks() -> None:
    response = client().get("/api/v1/copilot/tasks", headers=HEADERS)
    assert response.status_code == 200
    assert "Approve leave" in response.json()["answer"]


def test_missing_security_context_is_rejected() -> None:
    response = client().post("/api/v1/copilot/chat", json={"message": "hello"})
    assert response.status_code == 401


def test_prompt_route_lists_versioned_prompts() -> None:
    response = client().get("/api/v1/copilot/prompts", headers=HEADERS)
    assert response.status_code == 200
    entries = response.json()
    assert {entry["key"] for entry in entries} >= {
        "chat",
        "workflow_discovery",
        "task_assistant",
        "knowledge_search",
    }
    for entry in entries:
        assert entry["version"] == "v1"
        assert len(entry["sha256"]) == 64


def test_metrics_route_exposes_prompt_hashes_and_latencies() -> None:
    response = client().get("/api/v1/copilot/metrics", headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["prompt_hashes"]["chat"]
    assert len(body["prompt_hashes"]["chat"]) == 64
    assert isinstance(body["latencies"], dict)


APPROVAL_BODY = {
    "workflow_instance_id": "00000000-0000-0000-0000-000000000010",
    "title": "Approve leave",
    "description": "Ada requested three days of leave.",
    "assignee_id": "00000000-0000-0000-0000-000000000011",
}


def test_approval_endpoint_never_auto_confirms() -> None:
    tools = RecordingClient()
    test_client = client(tools)
    headers = {**HEADERS, "Idempotency-Key": "approval-key-1"}

    first = test_client.post("/api/v1/copilot/approvals", json=APPROVAL_BODY, headers=headers)
    assert first.status_code == 200
    proposal = first.json()
    assert proposal["requires_human_approval"] is True
    assert proposal["data"]["proposalId"]
    assert proposal["data"]["proposalHash"]
    assert tools.approval_count() == 0

    second = test_client.post(
        "/api/v1/copilot/approvals",
        json={
            **APPROVAL_BODY,
            "confirm": True,
            "proposal_id": proposal["data"]["proposalId"],
            "proposal_hash": proposal["data"]["proposalHash"],
        },
        headers={**headers, "Idempotency-Key": "approval-key-1"},
    )
    assert second.status_code == 200
    confirmed = second.json()
    assert confirmed["requires_human_approval"] is False
    assert confirmed["data"]["id"] == "approval-1"
    assert tools.approval_count() == 1

    replay = test_client.post(
        "/api/v1/copilot/approvals",
        json={
            **APPROVAL_BODY,
            "confirm": True,
            "proposal_id": proposal["data"]["proposalId"],
            "proposal_hash": proposal["data"]["proposalHash"],
        },
        headers={**headers, "Idempotency-Key": "approval-key-1"},
    )
    assert replay.status_code == 200
    assert tools.approval_count() == 1


def test_approval_confirmation_with_a_changed_payload_is_rejected() -> None:
    tools = RecordingClient()
    test_client = client(tools)
    first = test_client.post(
        "/api/v1/copilot/approvals", json=APPROVAL_BODY, headers=HEADERS
    ).json()

    response = test_client.post(
        "/api/v1/copilot/approvals",
        json={
            **APPROVAL_BODY,
            "title": "Approve a different request",
            "confirm": True,
            "proposal_id": first["data"]["proposalId"],
            "proposal_hash": first["data"]["proposalHash"],
        },
        headers=HEADERS,
    )

    assert response.status_code == 200
    assert response.json()["requires_human_approval"] is True
    assert response.json()["data"]["errorCode"] == "PROPOSAL_PAYLOAD_MISMATCH"
    assert tools.approval_count() == 0

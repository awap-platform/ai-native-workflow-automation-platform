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


def client() -> TestClient:
    app.state.copilot_agent = CopilotAgent(
        tools=ToolRegistry(FakeClient()),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
    )
    return TestClient(app)


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

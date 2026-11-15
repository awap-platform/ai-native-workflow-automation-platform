"""Async Copilot job contract tests (issue #290)."""

from __future__ import annotations

import asyncio
import time

from fastapi.testclient import TestClient

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.jobs import JobStore
from app.copilot.models import CopilotRequest, SecurityContext
from app.copilot.runner import JobRunner
from app.copilot.tools import ToolRegistry
from app.main import app

HEADERS = {
    "X-Tenant-Id": "00000000-0000-0000-0000-000000000001",
    "X-User-Id": "00000000-0000-0000-0000-000000000002",
    "X-User-Role": "TENANT_ADMIN",
    "X-Correlation-Id": "corr-jobs",
}
OTHER_TENANT = {**HEADERS, "X-Tenant-Id": "00000000-0000-0000-0000-000000000099"}
OTHER_USER = {**HEADERS, "X-User-Id": "00000000-0000-0000-0000-000000000098"}


class FakeClient:
    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        return {"recorded": True}


class SlowAgent(CopilotAgent):
    async def run(self, request: CopilotRequest, security: SecurityContext):  # type: ignore[override]
        await asyncio.sleep(5)
        return await super().run(request, security)


class ExplodingAgent(CopilotAgent):
    async def run(self, request: CopilotRequest, security: SecurityContext):  # type: ignore[override]
        raise RuntimeError("provider down")


def make_client(agent: CopilotAgent | None = None, store: JobStore | None = None) -> TestClient:
    app.state.copilot_agent = agent or CopilotAgent(
        tools=ToolRegistry(FakeClient()),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
    )
    app.state.copilot_jobs = store or JobStore()
    app.state.copilot_job_runner = JobRunner()
    return TestClient(app)


def submit(client: TestClient, **body: object) -> dict:
    payload = {"message": "hello", "action": "chat", **body}
    response = client.post("/api/v1/copilot/jobs", json=payload, headers=HEADERS)
    assert response.status_code == 202
    return response.json()


def wait_for(client: TestClient, job_id: str, headers: dict[str, str] = HEADERS) -> dict:
    deadline = time.monotonic() + 3.0
    body: dict = {}
    while time.monotonic() < deadline:
        body = client.get(f"/api/v1/copilot/jobs/{job_id}", headers=headers).json()
        if body.get("status") in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            return body
        time.sleep(0.01)
    return body


def test_a_job_is_submitted_polled_and_returns_the_agent_result() -> None:
    client = make_client()

    submitted = submit(client)

    assert submitted["status"] in {"QUEUED", "RUNNING", "SUCCEEDED"}
    assert submitted["prompt_version"] == "v1"
    final = wait_for(client, submitted["id"])
    assert final["status"] == "SUCCEEDED"
    assert final["result"]["answer"]
    assert final["result"]["cache_hit"] is False
    assert final["queue_wait_ms"] is not None


def test_duplicate_idempotency_keys_return_the_same_job() -> None:
    client = make_client()

    first = submit(client, idempotency_key="same-key")
    second = submit(client, idempotency_key="same-key")

    assert first["id"] == second["id"]


def test_idempotency_keys_are_scoped_to_the_tenant() -> None:
    client = make_client()

    first = submit(client, idempotency_key="shared-key")
    response = client.post(
        "/api/v1/copilot/jobs",
        json={"message": "hello", "action": "chat", "idempotency_key": "shared-key"},
        headers=OTHER_TENANT,
    )

    assert response.status_code == 202
    assert response.json()["id"] != first["id"]


def test_a_cancelled_job_stays_cancelled() -> None:
    client = make_client(agent=SlowAgent())
    submitted = submit(client)

    cancelled = client.post(f"/api/v1/copilot/jobs/{submitted['id']}/cancel", headers=HEADERS)

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    assert wait_for(client, submitted["id"])["status"] == "CANCELLED"


def test_a_failed_agent_is_reported_as_a_failed_job() -> None:
    client = make_client(agent=ExplodingAgent())
    submitted = submit(client)

    final = wait_for(client, submitted["id"])

    assert final["status"] == "FAILED"
    assert "provider down" in final["error"]


def test_a_full_queue_rejects_the_job_with_429() -> None:
    client = make_client(agent=SlowAgent(), store=JobStore(max_jobs=1))
    first = submit(client)

    rejected = client.post(
        "/api/v1/copilot/jobs",
        json={"message": "another", "action": "chat"},
        headers=HEADERS,
    )

    assert rejected.status_code == 429
    assert "full" in rejected.json()["detail"].lower()
    client.post(f"/api/v1/copilot/jobs/{first['id']}/cancel", headers=HEADERS)


def test_another_tenant_or_user_cannot_poll_the_job() -> None:
    client = make_client()
    submitted = submit(client)

    assert (
        client.get(f"/api/v1/copilot/jobs/{submitted['id']}", headers=OTHER_TENANT).status_code
        == 404
    )
    assert (
        client.get(f"/api/v1/copilot/jobs/{submitted['id']}", headers=OTHER_USER).status_code == 404
    )


def test_unknown_or_expired_jobs_return_404() -> None:
    client = make_client()

    assert client.get("/api/v1/copilot/jobs/missing", headers=HEADERS).status_code == 404
    assert client.post("/api/v1/copilot/jobs/missing/cancel", headers=HEADERS).status_code == 404


def test_a_completed_job_survives_prune_while_retained() -> None:
    store = JobStore(ttl_seconds=60.0)
    client = make_client(store=store)
    submitted = submit(client)
    wait_for(client, submitted["id"])

    assert store.prune() == 0
    assert client.get(f"/api/v1/copilot/jobs/{submitted['id']}", headers=HEADERS).status_code == 200

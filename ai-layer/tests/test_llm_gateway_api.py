"""HTTP mappings for LLM budget, rate-limit and outage errors (issue #294)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.llm_gateway import LlmGateway
from app.copilot.metrics import CopilotMetrics
from app.copilot.response_cache import ResponseCache
from app.copilot.tools import ToolRegistry
from app.main import app

HEADERS = {
    "X-Tenant-Id": "00000000-0000-0000-0000-000000000001",
    "X-User-Id": "00000000-0000-0000-0000-000000000002",
    "X-User-Role": "TENANT_ADMIN",
    "X-Correlation-Id": "corr-llm",
}


class FakeClient:
    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        return {"fullName": "Ada"}


class FakeLlm:
    def __init__(self, text: str | None = "answer", error: Exception | None = None) -> None:
        self.provider_id = "primary"
        self.text = text
        self.error = error

    async def complete(self, prompt: str, user_message: str, model: str) -> str | None:
        if self.error is not None:
            raise self.error
        return self.text


def client(gateway: LlmGateway) -> TestClient:
    app.state.copilot_agent = CopilotAgent(
        tools=ToolRegistry(FakeClient()),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
        llm_gateway=gateway,
        response_cache=ResponseCache(ttl_seconds=0),
    )
    return TestClient(app)


def test_a_rate_limited_call_returns_429_with_retry_after() -> None:
    gateway = LlmGateway(
        FakeLlm(),
        metrics=CopilotMetrics(),
        monthly_budget_tokens=10_000,
        per_minute_limit=1,
        cache_ttl_seconds=0,
    )
    http = client(gateway)

    assert (
        http.post("/api/v1/copilot/chat", json={"message": "hello"}, headers=HEADERS).status_code
        == 200
    )
    response = http.post("/api/v1/copilot/chat", json={"message": "hello again"}, headers=HEADERS)

    assert response.status_code == 429
    assert response.json()["code"] == "AI_RATE_LIMITED"
    assert int(response.headers["Retry-After"]) > 0


def test_an_exhausted_budget_returns_429_before_the_provider() -> None:
    gateway = LlmGateway(
        FakeLlm(),
        metrics=CopilotMetrics(),
        monthly_budget_tokens=1,
        per_minute_limit=10,
        cache_ttl_seconds=0,
        max_output_tokens=100,
    )
    http = client(gateway)

    response = http.post("/api/v1/copilot/chat", json={"message": "hello"}, headers=HEADERS)

    assert response.status_code == 429
    assert response.json()["code"] == "AI_BUDGET_EXCEEDED"
    assert int(response.headers["Retry-After"]) > 0


def test_an_llm_outage_returns_503() -> None:
    gateway = LlmGateway(
        FakeLlm(error=RuntimeError("down")),
        metrics=CopilotMetrics(),
        monthly_budget_tokens=10_000,
        per_minute_limit=10,
        cache_ttl_seconds=0,
    )
    http = client(gateway)

    response = http.post("/api/v1/copilot/chat", json={"message": "hello"}, headers=HEADERS)

    assert response.status_code == 503
    assert response.json()["code"] == "AI_UNAVAILABLE"

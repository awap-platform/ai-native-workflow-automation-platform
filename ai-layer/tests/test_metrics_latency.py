"""AI latency metric tests (issue #290)."""

from __future__ import annotations

import asyncio

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.metrics import CopilotMetrics, _percentile
from app.copilot.models import CopilotAction, CopilotRequest, SecurityContext
from app.copilot.tools import ToolRegistry


class FakeClient:
    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        return {"recorded": True}


def security() -> SecurityContext:
    return SecurityContext(
        tenant_id="00000000-0000-0000-0000-000000000001",
        user_id="00000000-0000-0000-0000-000000000002",
        role="TENANT_ADMIN",
        correlation_id="corr-latency",
    )


def agent() -> CopilotAgent:
    return CopilotAgent(
        tools=ToolRegistry(FakeClient()),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
    )


def test_percentiles_use_nearest_rank() -> None:
    metric = CopilotMetrics()
    for value in range(1, 101):
        metric.observe("copilot.request.duration", value)

    snapshot = metric.latency_snapshot()["copilot.request.duration"]

    assert snapshot["count"] == 100
    assert snapshot["p50"] == 50
    assert snapshot["p95"] == 95
    assert snapshot["p99"] == 99
    assert snapshot["max"] == 100


def test_percentile_of_an_empty_sample_is_zero() -> None:
    assert _percentile([], 95) == 0.0


def test_observations_are_tagged_in_a_deterministic_order() -> None:
    metric = CopilotMetrics()
    metric.observe("copilot.request.duration", 12.5, tier="cheap", action="chat", outcome="SUCCESS")

    assert list(metric.latency_snapshot()) == [
        "copilot.request.duration{action=chat,outcome=SUCCESS,tier=cheap}"
    ]


def test_negative_and_excess_samples_are_bounded() -> None:
    metric = CopilotMetrics()
    metric.observe("latency", -5)
    for value in range(CopilotMetrics.MAX_SAMPLES + 10):
        metric.observe("latency", value)

    snapshot = metric.latency_snapshot()["latency"]

    assert snapshot["count"] == CopilotMetrics.MAX_SAMPLES
    assert snapshot["max"] == CopilotMetrics.MAX_SAMPLES + 9


def test_a_synchronous_call_records_the_request_timer_with_exact_tags() -> None:
    copilot = agent()

    asyncio.run(
        copilot.run(
            CopilotRequest(message="hello", action=CopilotAction.CHAT),
            security(),
        )
    )

    snapshot = copilot.metrics.latency_snapshot()
    key = "copilot.request.duration{action=chat,cache_hit=false,outcome=SUCCESS,tier=cheap}"
    assert snapshot[key]["count"] == 1
    assert snapshot[key]["p95"] >= 0.0


def test_the_provider_timer_is_recorded_for_chat() -> None:
    copilot = agent()

    asyncio.run(
        copilot.run(
            CopilotRequest(message="hello", action=CopilotAction.CHAT),
            security(),
        )
    )

    snapshot = copilot.metrics.latency_snapshot()
    provider = [
        value for key, value in snapshot.items() if key.startswith("copilot.provider.duration{")
    ]

    assert provider
    assert provider[0]["count"] == 1

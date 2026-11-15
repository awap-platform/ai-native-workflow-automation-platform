"""Read-only response cache tests (issue #290)."""

from __future__ import annotations

import asyncio
import time

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.models import CopilotAction, CopilotRequest, CopilotResponse, SecurityContext
from app.copilot.response_cache import ResponseCache
from app.copilot.tools import ToolRegistry


class CountingClient:
    def __init__(self) -> None:
        self.calls = 0

    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        self.calls += 1
        return {"fullName": "Ada"}


def security() -> SecurityContext:
    return SecurityContext(
        tenant_id="00000000-0000-0000-0000-000000000001",
        user_id="00000000-0000-0000-0000-000000000002",
        role="TENANT_ADMIN",
        correlation_id="corr-cache",
    )


def response(answer: str = "cached") -> CopilotResponse:
    return CopilotResponse(
        answer=answer,
        action=CopilotAction.CHAT,
        confidence=0.9,
        prompt_key="chat",
        prompt_version="v1",
        prompt_hash="a" * 64,
        correlation_id="corr-cache",
    )


def cache_agent() -> tuple[CopilotAgent, CountingClient]:
    client = CountingClient()
    agent = CopilotAgent(
        tools=ToolRegistry(client),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
        response_cache=ResponseCache(ttl_seconds=60),
    )
    return agent, client


def test_put_and_get_round_trip() -> None:
    cache = ResponseCache(ttl_seconds=60)

    cache.put("k", response())

    assert cache.get("k") is not None
    assert len(cache) == 1


def test_an_empty_key_is_never_cached() -> None:
    cache = ResponseCache(ttl_seconds=60)

    cache.put("", response())

    assert cache.get("") is None
    assert len(cache) == 0


def test_a_zero_ttl_disables_the_cache() -> None:
    cache = ResponseCache(ttl_seconds=0)

    cache.put("k", response())

    assert cache.enabled is False
    assert cache.get("k") is None


def test_expired_entries_are_evicted() -> None:
    cache = ResponseCache(ttl_seconds=0.001)
    cache.put("k", response())

    time.sleep(0.01)

    assert cache.get("k") is None
    assert len(cache) == 0


def test_least_recently_used_entries_are_evicted() -> None:
    cache = ResponseCache(ttl_seconds=60, max_entries=1)
    cache.put("first", response("first"))

    cache.put("second", response("second"))

    assert cache.get("first") is None
    assert cache.get("second") is not None


def test_clear_removes_every_entry() -> None:
    cache = ResponseCache(ttl_seconds=60)
    cache.put("k", response())

    cache.clear()

    assert len(cache) == 0


def test_a_second_identical_chat_is_answered_from_the_cache() -> None:
    agent, client = cache_agent()
    request = CopilotRequest(message="hello", action=CopilotAction.CHAT)

    first = asyncio.run(agent.run(request, security()))
    calls_after_first = client.calls
    second = asyncio.run(agent.run(request, security()))

    assert first.cache_hit is False
    assert second.cache_hit is True
    assert second.answer == first.answer
    assert client.calls == calls_after_first
    assert agent.metrics.snapshot()["copilot.cache.hit"] == 1
    assert agent.metrics.snapshot()["copilot.cache.miss"] == 1
    assert any("cache_hit=true" in key for key in agent.metrics.latency_snapshot())


def test_state_changing_actions_are_never_cached() -> None:
    agent, client = cache_agent()
    request = CopilotRequest(message="my tasks", action=CopilotAction.QUERY_TASKS)

    first = asyncio.run(agent.run(request, security()))
    calls_after_first = client.calls
    second = asyncio.run(agent.run(request, security()))

    assert first.cache_hit is False
    assert second.cache_hit is False
    assert client.calls == calls_after_first * 2


def test_idempotent_and_high_risk_chat_requests_bypass_the_cache() -> None:
    agent, _ = cache_agent()

    idempotent = CopilotRequest(message="hello", action=CopilotAction.CHAT, idempotency_key="key-1")
    high_risk = CopilotRequest(message="hello", action=CopilotAction.CHAT, confirm_high_risk=True)

    assert agent._cache_key(idempotent, security()) is None
    assert agent._cache_key(high_risk, security()) is None

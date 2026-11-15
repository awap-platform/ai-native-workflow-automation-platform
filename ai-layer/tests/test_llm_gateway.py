"""LLM gateway budget, rate limit, cache, fallback and usage tests (issue #294)."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest

from app.copilot.llm_gateway import (
    InMemoryUsageStore,
    LlmBudgetExceeded,
    LlmGateway,
    LlmRateLimited,
    LlmUnavailable,
    LlmUsage,
    TenantLlmCache,
    estimate_tokens,
)
from app.copilot.metrics import CopilotMetrics


class FakeLlm:
    def __init__(
        self,
        provider_id: str = "primary",
        text: str | None = "answer",
        error: Exception | None = None,
        delay: float = 0.0,
    ) -> None:
        self.provider_id = provider_id
        self.text = text
        self.error = error
        self.delay = delay
        self.calls = 0

    async def complete(self, prompt: str, user_message: str, model: str) -> str | None:
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return self.text


class MutableClock:
    def __init__(self) -> None:
        self.value = datetime(2026, 11, 15, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.value


def gateway(primary: FakeLlm, **overrides: object) -> LlmGateway:
    arguments = {
        "monthly_budget_tokens": 1_000,
        "per_minute_limit": 10,
        "cache_ttl_seconds": 0.0,
        "max_output_tokens": 4,
        "cost_micros_per_token": 2,
        "store": InMemoryUsageStore(),
        "metrics": CopilotMetrics(),
        "clock": MutableClock(),
    }
    arguments.update(overrides)
    return LlmGateway(primary, **arguments)  # type: ignore[arg-type]


def call(gateway_instance: LlmGateway, tenant: str = "tenant-a", model: str = "gpt", **kwargs: str):
    return asyncio.run(
        gateway_instance.complete(
            "system", "hello", model, tenant_id=tenant, prompt_hash="hash", **kwargs
        )
    )


def test_a_call_under_budget_records_exact_tokens_and_cost() -> None:
    metric = CopilotMetrics()
    store = InMemoryUsageStore()
    instance = gateway(FakeLlm(text="hello"), metrics=metric, store=store, cost_micros_per_token=2)

    result = call(instance)

    assert result.text == "hello"
    assert result.provider == "primary"
    assert result.fallback_reason is None
    assert result.usage.prompt_tokens == 4
    assert result.usage.completion_tokens == 2
    assert result.usage.cost_micros == 12
    assert store.total_tokens("tenant-a") == 6
    assert store.reconcile("tenant-a") == {"rows": 1, "tokens": 6, "cost_micros": 12}
    assert metric.snapshot()["copilot.llm.tokens"] == 6


def test_an_identical_prompt_is_served_from_the_cache() -> None:
    primary = FakeLlm()
    metric = CopilotMetrics()
    instance = gateway(primary, cache_ttl_seconds=60, metrics=metric)

    first = call(instance)
    second = call(instance)

    assert first.cached is False
    assert second.cached is True
    assert second.text == first.text
    assert primary.calls == 1
    assert second.usage.prompt_tokens == 0
    assert metric.snapshot()["copilot.llm.cache.hit"] == 1


def test_the_cache_is_scoped_by_tenant_and_model() -> None:
    primary = FakeLlm()
    instance = gateway(primary, cache_ttl_seconds=60)

    call(instance, tenant="tenant-a", model="gpt")
    call(instance, tenant="tenant-a", model="gpt")
    call(instance, tenant="tenant-b", model="gpt")
    call(instance, tenant="tenant-a", model="other")

    assert primary.calls == 3


def test_budget_exhaustion_blocks_before_the_provider() -> None:
    primary = FakeLlm()
    instance = gateway(primary, monthly_budget_tokens=5, max_output_tokens=10)

    with pytest.raises(LlmBudgetExceeded) as caught:
        call(instance)

    assert caught.value.retry_after_seconds > 0
    assert primary.calls == 0
    assert instance.metrics.snapshot()["copilot.llm.budget.rejected"] == 1


def test_rate_limit_returns_retry_after() -> None:
    primary = FakeLlm()
    instance = gateway(primary, per_minute_limit=1)

    call(instance)

    with pytest.raises(LlmRateLimited) as caught:
        call(instance)

    assert 1 <= caught.value.retry_after_seconds <= 60
    assert primary.calls == 1


def test_fallback_records_provider_and_reason() -> None:
    primary = FakeLlm(error=RuntimeError("boom"))
    fallback = FakeLlm(provider_id="secondary", text="fallback")
    instance = gateway(primary, fallback=fallback)

    result = call(instance)

    assert result.text == "fallback"
    assert result.provider == "secondary"
    assert result.fallback_reason == "RuntimeError"
    assert result.usage.fallback_reason == "RuntimeError"
    assert primary.calls == 1
    assert fallback.calls == 1


def test_primary_empty_content_uses_the_fallback() -> None:
    primary = FakeLlm(text=None)
    fallback = FakeLlm(provider_id="secondary", text="fallback")
    instance = gateway(primary, fallback=fallback)

    result = call(instance)

    assert result.text == "fallback"
    assert result.fallback_reason == "empty"


def test_primary_empty_without_fallback_preserves_legacy_behavior() -> None:
    instance = gateway(FakeLlm(text=None))

    result = call(instance)

    assert result.text is None
    assert result.fallback_reason == "empty"
    assert result.provider == "primary"


def test_all_providers_failing_is_typed_and_releases_the_reservation() -> None:
    primary = FakeLlm(error=RuntimeError("primary-down"))
    fallback = FakeLlm(provider_id="secondary", error=TimeoutError("fallback-down"))
    store = InMemoryUsageStore()
    instance = gateway(primary, fallback=fallback, store=store)

    with pytest.raises(LlmUnavailable):
        call(instance)

    assert store.rows("tenant-a") == []
    primary.error = None
    primary.text = "recovered"
    assert call(instance).text == "recovered"


def test_an_idempotent_request_key_does_not_call_the_provider_twice() -> None:
    primary = FakeLlm()
    store = InMemoryUsageStore()
    instance = gateway(primary, store=store)

    first = call(instance, request_key="request-1")
    second = call(instance, request_key="request-1")

    assert first.text == second.text
    assert second.cached is True
    assert primary.calls == 1
    assert len(store.rows("tenant-a")) == 1


def test_a_usage_store_failure_is_fail_closed() -> None:
    class BrokenStore(InMemoryUsageStore):
        def record(self, usage: LlmUsage) -> bool:
            raise RuntimeError("store down")

    instance = gateway(FakeLlm(), store=BrokenStore())

    with pytest.raises(LlmUnavailable):
        call(instance)


def test_concurrent_calls_cannot_over_reserve_budget() -> None:
    primary = FakeLlm(delay=0.05)
    instance = gateway(primary, monthly_budget_tokens=30, max_output_tokens=10)

    def attempt(index: int) -> str:
        try:
            asyncio.run(
                instance.complete(
                    "",
                    "x",
                    "gpt",
                    tenant_id="tenant-a",
                    prompt_hash="h",
                    request_key=f"r-{index}",
                )
            )
            return "ok"
        except LlmBudgetExceeded:
            return "budget"

    with ThreadPoolExecutor(max_workers=10) as pool:
        outcomes = list(pool.map(attempt, range(10)))

    assert outcomes.count("ok") == 2
    assert outcomes.count("budget") == 8
    assert primary.calls == 2


def test_concurrent_calls_cannot_exceed_the_rate_limit() -> None:
    primary = FakeLlm()
    instance = gateway(primary, per_minute_limit=3)

    def attempt(index: int) -> str:
        try:
            asyncio.run(
                instance.complete(
                    "",
                    f"message-{index}",
                    "gpt",
                    tenant_id="tenant-a",
                    prompt_hash="h",
                )
            )
            return "ok"
        except LlmRateLimited:
            return "limited"

    with ThreadPoolExecutor(max_workers=10) as pool:
        outcomes = list(pool.map(attempt, range(10)))

    assert outcomes.count("ok") == 3
    assert outcomes.count("limited") == 7


def test_the_monthly_budget_resets_in_a_new_month() -> None:
    clock = MutableClock()
    primary = FakeLlm()
    instance = gateway(primary, monthly_budget_tokens=20, max_output_tokens=10, clock=clock)
    call(instance)

    clock.value = clock.value + timedelta(days=40)

    assert call(instance).text == "answer"


def test_usage_rows_are_idempotent_and_reconcile() -> None:
    store = InMemoryUsageStore()
    usage = LlmUsage("tenant-a", "r-1", "h", "gpt", 2, 3, 10, False, None)

    assert store.record(usage) is True
    assert store.record(usage) is False
    assert store.total_tokens("tenant-a") == 5
    assert store.reconcile("tenant-a") == {"rows": 1, "tokens": 5, "cost_micros": 10}


def test_estimator_and_cache_eviction_are_bounded() -> None:
    assert estimate_tokens("") == 0
    assert estimate_tokens("hello") == 2
    cache = TenantLlmCache(ttl_seconds=60, max_entries=2)
    cache.put("a", "one")
    cache.put("b", "two")
    cache.put("c", "three")

    assert len(cache) == 2
    assert cache.get("a") is None
    assert cache.get("c") == "three"

"""Shared AI-layer LLM gateway (issue #294).

Every Copilot model call goes through this gateway. It enforces a tenant-scoped monthly token
budget, a per-tenant per-minute rate limit, a tenant/prompt/model-scoped response cache and an
optional fallback provider. Usage is recorded idempotently by
``(tenant, request_key, prompt_hash, model)``.

The default store and budget state are in-memory, so a multi-replica deployment must move them to a
shared store; the `UsageStore` protocol is the seam for that migration. A failed usage write is
fail-closed: the caller receives `LlmUnavailable` rather than an unaudited answer.
"""

from __future__ import annotations

import hashlib
import math
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Protocol

from app.copilot.metrics import CopilotMetrics


class LlmError(RuntimeError):
    """Base class for typed, user-facing LLM errors."""

    def __init__(self, message: str, retry_after_seconds: int = 0) -> None:
        super().__init__(message)
        self.retry_after_seconds = max(0, retry_after_seconds)


class LlmBudgetExceeded(LlmError):
    """The tenant's monthly token budget would be exceeded before the provider call."""


class LlmRateLimited(LlmError):
    """The tenant exceeded its per-minute request allowance."""


class LlmUnavailable(LlmError):
    """Every configured provider failed; no answer is fabricated."""


class LlmClientProtocol(Protocol):
    async def complete(self, prompt: str, user_message: str, model: str) -> str | None: ...


@dataclass(frozen=True)
class LlmUsage:
    tenant_id: str
    request_key: str
    prompt_hash: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_micros: int
    cached: bool
    fallback_reason: str | None


@dataclass(frozen=True)
class LlmResult:
    text: str | None
    provider: str
    model: str
    cached: bool
    fallback_reason: str | None
    usage: LlmUsage


class UsageStore(Protocol):
    def record(self, usage: LlmUsage) -> bool:
        """Return False when the exact usage row already exists (idempotent write)."""

    def total_tokens(self, tenant_id: str) -> int: ...

    def rows(self, tenant_id: str) -> list[LlmUsage]: ...

    def reconcile(self, tenant_id: str) -> dict[str, int]: ...


class InMemoryUsageStore:
    """Thread-safe ledger used for tests and single-process deployments."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rows: dict[tuple[str, str, str, str], LlmUsage] = {}

    def record(self, usage: LlmUsage) -> bool:
        key = (usage.tenant_id, usage.request_key, usage.prompt_hash, usage.model)
        with self._lock:
            if key in self._rows:
                return False
            self._rows[key] = usage
            return True

    def total_tokens(self, tenant_id: str) -> int:
        with self._lock:
            return sum(
                row.prompt_tokens + row.completion_tokens
                for row in self._rows.values()
                if row.tenant_id == tenant_id
            )

    def rows(self, tenant_id: str) -> list[LlmUsage]:
        with self._lock:
            return [row for row in self._rows.values() if row.tenant_id == tenant_id]

    def reconcile(self, tenant_id: str) -> dict[str, int]:
        with self._lock:
            rows = [row for row in self._rows.values() if row.tenant_id == tenant_id]
        return {
            "rows": len(rows),
            "tokens": sum(row.prompt_tokens + row.completion_tokens for row in rows),
            "cost_micros": sum(row.cost_micros for row in rows),
        }


class TenantLlmCache:
    """Tenant-safe LRU + TTL cache keyed by tenant, prompt hash, model and message."""

    def __init__(self, ttl_seconds: float = 30.0, max_entries: int = 256) -> None:
        self.ttl_seconds = max(0.0, ttl_seconds)
        self.max_entries = max(1, max_entries)
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, tuple[str, float]] = OrderedDict()

    def get(self, key: str) -> str | None:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            text, expires_at = entry
            if expires_at <= time.time():
                self._entries.pop(key, None)
                return None
            self._entries.move_to_end(key)
            return text

    def put(self, key: str, text: str) -> None:
        if self.ttl_seconds <= 0:
            return
        with self._lock:
            self._entries[key] = (text, time.time() + self.ttl_seconds)
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


@dataclass
class _TenantState:
    month: str
    used_tokens: int = 0
    calls: deque[float] = field(default_factory=deque)


def estimate_tokens(text: str) -> int:
    """Conservative character-based estimate used for admission and usage rows."""
    if not text:
        return 0
    return max(1, math.ceil(len(text) / 4))


def _provider_id(client: object, default: str) -> str:
    return str(getattr(client, "provider_id", default))


class LlmGateway:
    def __init__(
        self,
        primary: LlmClientProtocol,
        *,
        fallback: LlmClientProtocol | None = None,
        metrics: CopilotMetrics | None = None,
        monthly_budget_tokens: int = 1_000_000,
        per_minute_limit: int = 60,
        cache_ttl_seconds: float = 30.0,
        cache_max_entries: int = 256,
        cost_micros_per_token: int = 2,
        max_output_tokens: int = 1_024,
        store: UsageStore | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.primary = primary
        self.fallback = fallback
        self.metrics = metrics or CopilotMetrics()
        self.monthly_budget_tokens = monthly_budget_tokens if monthly_budget_tokens > 0 else None
        self.per_minute_limit = per_minute_limit if per_minute_limit > 0 else None
        self.cost_micros_per_token = max(0, cost_micros_per_token)
        self.max_output_tokens = max(1, max_output_tokens)
        self.cache = (
            TenantLlmCache(cache_ttl_seconds, cache_max_entries) if cache_ttl_seconds > 0 else None
        )
        self.store = store or InMemoryUsageStore()
        self._clock = clock or (lambda: datetime.now(UTC))
        self._lock = threading.Lock()
        self._states: dict[str, _TenantState] = {}
        self._completed: dict[tuple[str, str, str, str], LlmResult] = {}

    async def complete(
        self,
        prompt: str,
        user_message: str,
        model: str,
        *,
        tenant_id: str,
        prompt_hash: str = "",
        request_key: str | None = None,
    ) -> LlmResult:
        effective_model = model or "local-heuristic"
        prompt_tokens = estimate_tokens(prompt) + estimate_tokens(user_message)
        usage_key = (tenant_id, request_key or "", prompt_hash, effective_model)
        if request_key:
            with self._lock:
                existing = self._completed.get(usage_key)
            if existing is not None:
                self.metrics.increment("copilot.llm.idempotent.hit")
                return replace(existing, cached=True)

        cache_key = self._cache_key(tenant_id, prompt_hash, effective_model, user_message)
        if self.cache is not None:
            cached_text = self.cache.get(cache_key)
            if cached_text is not None:
                usage = self._usage(
                    tenant_id, request_key, prompt_hash, effective_model, 0, 0, 0, True, None
                )
                self.metrics.increment("copilot.llm.cache.hit")
                return LlmResult(cached_text, "cache", effective_model, True, None, usage)

        estimated = prompt_tokens + self.max_output_tokens
        now = self._clock()
        with self._lock:
            self._admit(tenant_id, estimated, now)

        try:
            text, provider, reason = await self._invoke(prompt, user_message, effective_model)
        except LlmUnavailable:
            with self._lock:
                self._release(tenant_id, estimated, now)
            self.metrics.increment("copilot.llm.calls", 1)
            self.metrics.increment("copilot.llm.failures")
            raise

        completion_tokens = estimate_tokens(text or "")
        with self._lock:
            self._settle(tenant_id, estimated, completion_tokens, now)
        cost_micros = (prompt_tokens + completion_tokens) * self.cost_micros_per_token
        usage = self._usage(
            tenant_id,
            request_key,
            prompt_hash,
            effective_model,
            prompt_tokens,
            completion_tokens,
            cost_micros,
            False,
            reason,
        )
        try:
            self.store.record(usage)
        except Exception as ex:  # noqa: BLE001 - usage must never be silently lost
            self.metrics.increment("copilot.llm.usage.failures")
            raise LlmUnavailable("LLM usage persistence is unavailable.", 30) from ex

        self.metrics.increment(
            "copilot.llm.calls",
            1,
        )
        self.metrics.increment("copilot.llm.tokens", prompt_tokens + completion_tokens)
        self.metrics.increment("copilot.llm.cost.micros", cost_micros)
        if reason is not None:
            self.metrics.increment(f"copilot.llm.fallback.{reason}")
        if text and self.cache is not None:
            self.cache.put(cache_key, text)
        result = LlmResult(text, provider, effective_model, False, reason, usage)
        if request_key:
            with self._lock:
                self._completed[usage_key] = result
        return result

    async def _invoke(
        self, prompt: str, user_message: str, model: str
    ) -> tuple[str | None, str, str | None]:
        primary_id = _provider_id(self.primary, "primary")
        reason: str | None
        try:
            text = await self.primary.complete(prompt, user_message, model)
        except Exception as ex:  # noqa: BLE001 - provider failures are mapped, never leaked
            text = None
            reason = type(ex).__name__
        else:
            reason = None if text is not None else "empty"
        if text is not None:
            return text, primary_id, None
        if self.fallback is None:
            if reason == "empty":
                return None, primary_id, reason
            raise LlmUnavailable(f"Primary LLM failed: {reason}", 5)

        fallback_id = _provider_id(self.fallback, "fallback")
        try:
            fallback_text = await self.fallback.complete(prompt, user_message, model)
        except Exception as ex:  # noqa: BLE001 - all providers failed
            raise LlmUnavailable(
                f"All LLM providers failed: {reason}, {type(ex).__name__}", 5
            ) from ex
        if fallback_text is None:
            raise LlmUnavailable(f"All LLM providers failed: {reason}, empty-fallback", 5)
        return fallback_text, fallback_id, reason or "empty"

    def _admit(self, tenant_id: str, tokens: int, now: datetime) -> None:
        state = self._state(tenant_id, now)
        self._rate_limit(state, now)
        if self.monthly_budget_tokens is not None:
            if state.used_tokens + tokens > self.monthly_budget_tokens:
                self.metrics.increment("copilot.llm.budget.rejected")
                raise LlmBudgetExceeded(
                    "The tenant's monthly AI token budget is exhausted.",
                    self._seconds_to_next_month(now),
                )
            state.used_tokens += tokens

    def _rate_limit(self, state: _TenantState, now: datetime) -> None:
        if self.per_minute_limit is None:
            return
        timestamp = now.timestamp()
        while state.calls and timestamp - state.calls[0] >= 60:
            state.calls.popleft()
        if len(state.calls) >= self.per_minute_limit:
            retry_after = max(1, math.ceil(60 - (timestamp - state.calls[0])))
            self.metrics.increment("copilot.llm.rate.rejected")
            raise LlmRateLimited("The tenant exceeded the Copilot request rate limit.", retry_after)
        state.calls.append(timestamp)

    def _state(self, tenant_id: str, now: datetime) -> _TenantState:
        month = now.strftime("%Y-%m")
        state = self._states.get(tenant_id)
        if state is None or state.month != month:
            state = _TenantState(month=month)
            self._states[tenant_id] = state
        return state

    def _settle(self, tenant_id: str, estimated: int, actual: int, now: datetime) -> None:
        if self.monthly_budget_tokens is None:
            return
        state = self._state(tenant_id, now)
        state.used_tokens = max(0, state.used_tokens - estimated + actual)

    def _release(self, tenant_id: str, estimated: int, now: datetime) -> None:
        if self.monthly_budget_tokens is None:
            return
        state = self._state(tenant_id, now)
        state.used_tokens = max(0, state.used_tokens - estimated)

    @staticmethod
    def _seconds_to_next_month(now: datetime) -> int:
        if now.month == 12:
            next_month = now.replace(
                year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0
            )
        else:
            next_month = now.replace(
                month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0
            )
        return max(1, math.ceil((next_month - now).total_seconds()))

    @staticmethod
    def _cache_key(tenant_id: str, prompt_hash: str, model: str, message: str) -> str:
        digest = hashlib.sha256(message.encode("utf-8")).hexdigest()
        return f"{tenant_id}:{prompt_hash}:{model}:{digest}"

    @staticmethod
    def _usage(
        tenant_id: str,
        request_key: str | None,
        prompt_hash: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        cost_micros: int,
        cached: bool,
        fallback_reason: str | None,
    ) -> LlmUsage:
        return LlmUsage(
            tenant_id=tenant_id,
            request_key=request_key or "",
            prompt_hash=prompt_hash,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_micros=cost_micros,
            cached=cached,
            fallback_reason=fallback_reason,
        )

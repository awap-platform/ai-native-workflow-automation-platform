"""Bounded, TTL-scoped cache for read-only Copilot answers (issue #290).

A cache hit is a latency outcome: it must be visible in the latency metric as ``cache_hit=true``
and must not re-run the agent graph or any backend tool. Only explicit, read-only ``CHAT`` requests
are cacheable; high-risk, state-changing and idempotent requests always execute.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

from app.copilot.models import CopilotResponse


@dataclass(frozen=True)
class CacheEntry:
    response: CopilotResponse
    expires_at: float


class ResponseCache:
    """A small LRU + TTL cache; a zero TTL disables caching entirely."""

    def __init__(self, ttl_seconds: float = 30.0, max_entries: int = 256) -> None:
        self.ttl_seconds = max(0.0, ttl_seconds)
        self.max_entries = max(1, max_entries)
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, CacheEntry] = OrderedDict()

    @property
    def enabled(self) -> bool:
        return self.ttl_seconds > 0

    def get(self, key: str) -> CopilotResponse | None:
        if not key:
            return None
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= time.time():
                self._entries.pop(key, None)
                return None
            self._entries.move_to_end(key)
            return entry.response

    def put(self, key: str, response: CopilotResponse) -> None:
        if not key or not self.enabled:
            return
        with self._lock:
            self._entries[key] = CacheEntry(
                response=response, expires_at=time.time() + self.ttl_seconds
            )
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

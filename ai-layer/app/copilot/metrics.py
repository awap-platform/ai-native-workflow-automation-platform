"""Small dependency-free metrics registry for the copilot.

The AI layer is deployed next to the backend; these counters are exposed on
``/api/v1/copilot/metrics`` for local debugging and are mirrored into structured logs. They do not
replace Micrometer/Prometheus, which remain the platform source of truth.
"""

from __future__ import annotations

import threading
from collections import Counter


class CopilotMetrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: Counter[str] = Counter()

    def increment(self, name: str, amount: int = 1) -> None:
        with self._lock:
            self._counters[name] += amount

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counters)

"""Small dependency-free metrics registry for the copilot.

Counters are exposed on ``/api/v1/copilot/metrics`` for local debugging. Latency observations are
kept in a bounded per-metric reservoir so the async job path and the synchronous API can report
p50/p95/p99 without adding a Prometheus client dependency (issue #290). Platform Prometheus remains
the production source of truth.
"""

from __future__ import annotations

import math
import threading
from collections import Counter


def _percentile(sorted_values: list[float], percentile: float) -> float:
    if not sorted_values:
        return 0.0
    rank = math.ceil(percentile / 100.0 * len(sorted_values)) - 1
    index = max(0, min(len(sorted_values) - 1, rank))
    return round(sorted_values[index], 3)


class CopilotMetrics:
    MAX_SAMPLES = 1_000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: Counter[str] = Counter()
        self._latencies: dict[str, list[float]] = {}

    def increment(self, name: str, amount: int = 1) -> None:
        with self._lock:
            self._counters[name] += amount

    def observe(self, name: str, value_ms: float, **tags: str) -> None:
        key = name
        if tags:
            suffix = ",".join(f"{tag}={tags[tag]}" for tag in sorted(tags))
            key = f"{name}{{{suffix}}}"
        with self._lock:
            samples = self._latencies.setdefault(key, [])
            samples.append(max(0.0, float(value_ms)))
            if len(samples) > self.MAX_SAMPLES:
                del samples[: len(samples) - self.MAX_SAMPLES]

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counters)

    def latency_snapshot(self) -> dict[str, dict[str, float | int]]:
        with self._lock:
            result: dict[str, dict[str, float | int]] = {}
            for key, values in self._latencies.items():
                ordered = sorted(values)
                result[key] = {
                    "count": len(ordered),
                    "p50": _percentile(ordered, 50),
                    "p95": _percentile(ordered, 95),
                    "p99": _percentile(ordered, 99),
                    "max": round(ordered[-1], 3),
                }
            return result

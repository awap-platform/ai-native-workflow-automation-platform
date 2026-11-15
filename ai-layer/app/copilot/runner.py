"""Background execution of an async Copilot job (issue #290).

The runner is deliberately small: the job store owns state, the agent owns behaviour, and this
module only glues them together. A provider timeout is a failure, not a crash; a cancelled job is
never overwritten by a late provider answer.

Jobs run on a dedicated daemon event loop rather than the HTTP request loop. The request loop is
allowed to end when the response is sent, so binding a job task to it would cancel the job as soon
as the submission response completed.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading

from app.copilot.agent import CopilotAgent
from app.copilot.jobs import JobStatus, JobStore
from app.copilot.metrics import CopilotMetrics


async def run_async_job(
    job_id: str,
    store: JobStore,
    agent: CopilotAgent,
    metrics: CopilotMetrics | None = None,
) -> None:
    """Execute a queued job and record its terminal state.

    Cancellation is cooperative: the runner cancels the asyncio task, so the provider call is
    aborted where the client library supports it. The provider's own timeout remains the hard bound.
    """
    job_metrics = metrics or agent.metrics
    running = store.mark_running(job_id)
    if running is None or running.status is not JobStatus.RUNNING:
        return
    if running.queue_wait_ms is not None:
        job_metrics.observe("copilot.job.queue.wait", running.queue_wait_ms)
    try:
        result = await agent.run(running.request, running.security)
    except asyncio.CancelledError:
        store.cancel(job_id, running.tenant_id, running.user_id)
        raise
    except Exception as ex:  # noqa: BLE001 - any provider failure must become a job error
        store.mark_failed(job_id, f"{type(ex).__name__}: {ex}")
        job_metrics.increment("copilot.job.failed")
        return
    finished = store.mark_succeeded(job_id, result)
    if finished is not None and finished.status is JobStatus.SUCCEEDED:
        job_metrics.increment("copilot.job.succeeded")


class JobRunner:
    """Owns the persistent job event loop and the futures needed for cancellation."""

    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._lock = threading.Lock()
        self._futures: dict[str, concurrent.futures.Future[None]] = {}
        self._thread = threading.Thread(target=self._serve, name="copilot-job-runner", daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def submit(
        self,
        job_id: str,
        store: JobStore,
        agent: CopilotAgent,
        metrics: CopilotMetrics | None = None,
    ) -> None:
        future = asyncio.run_coroutine_threadsafe(
            run_async_job(job_id, store, agent, metrics), self._loop
        )
        with self._lock:
            self._futures[job_id] = future
        future.add_done_callback(lambda _future: self._forget(job_id))

    def cancel(self, job_id: str) -> None:
        with self._lock:
            future = self._futures.get(job_id)
        if future is not None:
            future.cancel()

    def running(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._futures

    def _forget(self, job_id: str) -> None:
        with self._lock:
            self._futures.pop(job_id, None)

    def shutdown(self) -> None:
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=1.0)

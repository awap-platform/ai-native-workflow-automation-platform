"""Async Copilot job state model and bounded in-memory store (issue #290).

The state machine is explicit because an async job outlives the HTTP request that created it:

    QUEUED -> RUNNING -> SUCCEEDED
                      -> FAILED
    QUEUED -> CANCELLED
    RUNNING -> CANCELLED (best effort; the provider call is bounded by its own timeout)

Every transition is tenant/user scoped and updates ``updated_at`` so the TTL sweep can evict old
jobs. Idempotency keys are scoped to the tenant: a retry with the same key returns the original job
instead of starting duplicate work.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import StrEnum

from app.copilot.models import (
    CopilotJobResponse,
    CopilotRequest,
    CopilotResponse,
    JobStatusResponse,
    SecurityContext,
)
from app.copilot.prompts import PROMPT_VERSION


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


@dataclass
class CopilotJob:
    id: str
    tenant_id: str
    user_id: str
    request: CopilotRequest
    security: SecurityContext
    status: JobStatus = JobStatus.QUEUED
    result: CopilotResponse | None = None
    error: str | None = None
    prompt_version: str = PROMPT_VERSION
    prompt_hash: str | None = None
    queue_wait_ms: float | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class JobQueueFull(RuntimeError):
    """The bounded store cannot accept another job."""


class JobStore:
    """Bounded, tenant/user-scoped job store with idempotency and TTL retention."""

    def __init__(self, max_jobs: int = 1_000, ttl_seconds: float = 3_600.0) -> None:
        self.max_jobs = max(1, max_jobs)
        self.ttl_seconds = max(1.0, ttl_seconds)
        self._lock = threading.Lock()
        self._jobs: dict[str, CopilotJob] = {}
        self._by_idempotency: dict[tuple[str, str], str] = {}

    def submit(self, request: CopilotRequest, security: SecurityContext) -> CopilotJob:
        with self._lock:
            self._prune_locked(time.time())
            if request.idempotency_key:
                key = (security.tenant_id, request.idempotency_key)
                existing = self._by_idempotency.get(key)
                if existing and existing in self._jobs:
                    return self._jobs[existing]
            if len(self._jobs) >= self.max_jobs:
                raise JobQueueFull("The async Copilot queue is full.")
            job = CopilotJob(
                id=str(uuid.uuid4()),
                tenant_id=security.tenant_id,
                user_id=security.user_id,
                request=request,
                security=security,
            )
            self._jobs[job.id] = job
            if request.idempotency_key:
                self._by_idempotency[(security.tenant_id, request.idempotency_key)] = job.id
            return job

    def get(self, job_id: str, tenant_id: str, user_id: str) -> CopilotJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.tenant_id != tenant_id or job.user_id != user_id:
                return None
            return job

    def cancel(self, job_id: str, tenant_id: str, user_id: str) -> CopilotJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.tenant_id != tenant_id or job.user_id != user_id:
                return None
            if job.status in {JobStatus.QUEUED, JobStatus.RUNNING}:
                job.status = JobStatus.CANCELLED
                job.updated_at = time.time()
            return job

    def mark_running(self, job_id: str) -> CopilotJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status != JobStatus.QUEUED:
                return job
            job.status = JobStatus.RUNNING
            job.queue_wait_ms = round(max(0.0, (time.time() - job.created_at) * 1_000.0), 3)
            job.updated_at = time.time()
            return job

    def mark_succeeded(self, job_id: str, result: CopilotResponse) -> CopilotJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status == JobStatus.CANCELLED:
                return job
            job.status = JobStatus.SUCCEEDED
            job.result = result
            job.prompt_hash = result.prompt_hash
            job.updated_at = time.time()
            return job

    def mark_failed(self, job_id: str, error: str) -> CopilotJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status == JobStatus.CANCELLED:
                return job
            job.status = JobStatus.FAILED
            job.error = error[:500]
            job.updated_at = time.time()
            return job

    def prune(self) -> int:
        with self._lock:
            return self._prune_locked(time.time())

    def _prune_locked(self, now: float) -> int:
        expired = [
            job_id for job_id, job in self._jobs.items() if now - job.updated_at > self.ttl_seconds
        ]
        for job_id in expired:
            self._jobs.pop(job_id, None)
        if expired:
            self._by_idempotency = {
                key: value for key, value in self._by_idempotency.items() if value not in expired
            }
        return len(expired)


def job_response(job: CopilotJob) -> CopilotJobResponse:
    """Project the internal dataclass onto the public, versioned API contract."""
    return CopilotJobResponse(
        id=job.id,
        status=JobStatusResponse(job.status.value),
        result=job.result,
        error=job.error,
        prompt_version=job.prompt_version,
        prompt_hash=job.prompt_hash,
        queue_wait_ms=job.queue_wait_ms,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )

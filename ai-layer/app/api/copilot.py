"""HTTP API for the AI Copilot service."""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.copilot.agent import CopilotAgent
from app.copilot.jobs import JobQueueFull, JobStatus, JobStore, job_response
from app.copilot.models import (
    ApprovalAssistanceRequest,
    CopilotAction,
    CopilotJobResponse,
    CopilotRequest,
    CopilotResponse,
    KnowledgeSearchRequest,
    MetricsResponse,
    PromptDescriptor,
    SecurityContext,
    TaskCompletionRequest,
    WorkflowDiscoveryRequest,
    WorkflowInitiationRequest,
)
from app.copilot.prompts import PROMPT_VERSION, describe_prompts, prompt_hash
from app.copilot.runner import JobRunner

router = APIRouter(prefix="/copilot", tags=["copilot"])


def get_agent(request: Request) -> CopilotAgent:
    agent = getattr(request.app.state, "copilot_agent", None)
    if agent is None:
        agent = CopilotAgent()
        request.app.state.copilot_agent = agent
    return agent


def get_job_store(request: Request) -> JobStore:
    """Return the process-local bounded job store; retention is TTL and capacity bounded."""
    store = getattr(request.app.state, "copilot_jobs", None)
    if store is None:
        store = JobStore(
            max_jobs=int(os.getenv("AI_JOB_MAX_JOBS", "1000")),
            ttl_seconds=float(os.getenv("AI_JOB_TTL_SECONDS", "3600")),
        )
        request.app.state.copilot_jobs = store
    return store


def get_job_runner(request: Request) -> JobRunner:
    runner = getattr(request.app.state, "copilot_job_runner", None)
    if runner is None:
        runner = JobRunner()
        request.app.state.copilot_job_runner = runner
    return runner


def security_context(
    x_tenant_id: str = Header(default=""),
    x_user_id: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_user_permissions: str = Header(default=""),
    x_ai_service_token: str = Header(default=""),
    x_correlation_id: str = Header(default=""),
    authorization: str = Header(default=""),
    x_ai_remaining_budget_tokens: str = Header(default=""),
    x_ai_latency_budget_ms: str = Header(default=""),
    x_ai_task_risk: str = Header(default=""),
) -> SecurityContext:
    """Build the caller context and verify the backend service credential.

    The backend forwards the authenticated user's tenant, role and permission set. The AI layer
    never trusts a model to supply these values; they are request metadata.
    """
    expected = os.getenv("AI_LAYER_SERVICE_TOKEN", "")
    if expected and x_ai_service_token != expected:
        raise HTTPException(status_code=401, detail="Invalid AI service token.")
    if not x_tenant_id or not x_user_id or not x_user_role:
        raise HTTPException(status_code=401, detail="Authenticated security context is required.")
    access_token = authorization.removeprefix("Bearer ").strip() or None
    return SecurityContext(
        tenant_id=x_tenant_id,
        user_id=x_user_id,
        role=x_user_role,
        permissions=[
            permission.strip() for permission in x_user_permissions.split(",") if permission.strip()
        ],
        correlation_id=x_correlation_id,
        access_token=access_token,
        # Routing metadata is server-derived: the backend sets these headers from its authoritative
        # budget service. The SPA request body cannot influence them (issue #300).
        remaining_budget_tokens=_optional_int(x_ai_remaining_budget_tokens),
        latency_budget_ms=_optional_int(x_ai_latency_budget_ms),
        task_risk=x_ai_task_risk or None,
    )


def _optional_int(value: str) -> int | None:
    """Malformed routing metadata is ignored and the router uses its documented default."""
    try:
        return int(value) if value.strip() else None
    except ValueError:
        return None


@router.post("/chat", response_model=CopilotResponse)
async def chat(
    body: CopilotRequest,
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
) -> CopilotResponse:
    return await agent.run(body, security)


@router.post("/workflows/discover", response_model=CopilotResponse)
async def discover_workflow(
    body: WorkflowDiscoveryRequest,
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
) -> CopilotResponse:
    return await agent.run(
        CopilotRequest(message=body.query, action=CopilotAction.DISCOVER_WORKFLOW), security
    )


@router.post("/workflows/initiate", response_model=CopilotResponse)
async def initiate_workflow(
    body: WorkflowInitiationRequest,
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
) -> CopilotResponse:
    return await agent.run(
        CopilotRequest(
            message=f"Start workflow {body.workflow_id}",
            action=CopilotAction.START_WORKFLOW,
            context={**body.context, "workflowId": body.workflow_id},
            idempotency_key=body.idempotency_key,
            confirm_high_risk=body.confirm_high_risk,
        ),
        security,
    )


@router.get("/tasks", response_model=CopilotResponse)
async def query_tasks(
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
) -> CopilotResponse:
    return await agent.run(
        CopilotRequest(message="my tasks", action=CopilotAction.QUERY_TASKS), security
    )


@router.post("/tasks/{task_id}/complete", response_model=CopilotResponse)
async def complete_task(
    task_id: str,
    body: TaskCompletionRequest,
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> CopilotResponse:
    return await agent.run(
        CopilotRequest(
            message=f"Complete task {task_id}",
            action=CopilotAction.COMPLETE_TASK,
            context={
                "taskId": task_id,
                "decision": body.decision,
                "comment": body.comment,
            },
            idempotency_key=idempotency_key,
            confirm_high_risk=body.confirm_high_risk,
        ),
        security,
    )


@router.post("/approvals", response_model=CopilotResponse)
async def approval_assistance(
    body: ApprovalAssistanceRequest,
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
) -> CopilotResponse:
    """Propose an approval, then create it only after an explicit, bound confirmation.

    The transport layer never sets the confirmation flag: ``confirm`` must come from the caller and
    the second request must carry the proposal id/hash issued by the first response (issue #296).
    """
    return await agent.run(
        CopilotRequest(
            message=body.description or body.title,
            action=CopilotAction.APPROVAL_ASSISTANCE,
            context={
                "workflowInstanceId": body.workflow_instance_id,
                "title": body.title,
                "description": body.description,
                "assigneeId": body.assignee_id,
                "proposalId": body.proposal_id,
                "proposalHash": body.proposal_hash,
            },
            idempotency_key=body.idempotency_key,
            confirm_high_risk=body.confirm,
        ),
        security,
    )


@router.post("/knowledge/search", response_model=CopilotResponse)
async def knowledge_search(
    body: KnowledgeSearchRequest,
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
) -> CopilotResponse:
    return await agent.run(
        CopilotRequest(message=body.query, action=CopilotAction.KNOWLEDGE_SEARCH), security
    )


@router.post("/jobs", response_model=CopilotJobResponse, status_code=202)
async def submit_job(
    body: CopilotRequest,
    request: Request,
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
) -> CopilotJobResponse:
    """Accept long-running Copilot work and return immediately with a job handle.

    A duplicate submission with the same tenant-scoped ``idempotency_key`` returns the original
    job. A full queue is rejected with ``429`` so the caller can retry or use the sync path.
    """
    store = get_job_store(request)
    try:
        job = store.submit(body, security)
    except JobQueueFull as ex:
        agent.metrics.increment("copilot.job.rejected")
        raise HTTPException(status_code=429, detail=str(ex)) from ex
    runner = get_job_runner(request)
    if job.status is JobStatus.QUEUED and not runner.running(job.id):
        runner.submit(job.id, store, agent, agent.metrics)
        agent.metrics.increment("copilot.job.submitted")
    return job_response(job)


@router.get("/jobs/{job_id}", response_model=CopilotJobResponse)
async def job_status(
    job_id: str,
    request: Request,
    security: SecurityContext = Depends(security_context),
) -> CopilotJobResponse:
    """Poll a job; another tenant's job is indistinguishable from a missing one."""
    job = get_job_store(request).get(job_id, security.tenant_id, security.user_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job_response(job)


@router.post("/jobs/{job_id}/cancel", response_model=CopilotJobResponse)
async def cancel_job(
    job_id: str,
    request: Request,
    agent: CopilotAgent = Depends(get_agent),
    security: SecurityContext = Depends(security_context),
) -> CopilotJobResponse:
    """Cancel a queued or running job; cancellation of a provider call is best effort."""
    job = get_job_store(request).cancel(job_id, security.tenant_id, security.user_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    get_job_runner(request).cancel(job_id)
    if job.status is JobStatus.CANCELLED:
        agent.metrics.increment("copilot.job.cancelled")
    return job_response(job)


@router.get("/prompts", response_model=list[PromptDescriptor])
async def prompts(
    _security: SecurityContext = Depends(security_context),
) -> list[PromptDescriptor]:
    return describe_prompts()


@router.get("/metrics", response_model=MetricsResponse)
async def metrics(
    agent: CopilotAgent = Depends(get_agent),
    _security: SecurityContext = Depends(security_context),
) -> MetricsResponse:
    prompts = describe_prompts()
    return MetricsResponse(
        counters=agent.metrics.snapshot(),
        prompt_version=PROMPT_VERSION,
        prompt_hashes={descriptor.key: prompt_hash(descriptor.key) for descriptor in prompts},
        latencies=agent.metrics.latency_snapshot(),
    )

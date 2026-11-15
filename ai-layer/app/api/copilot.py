"""HTTP API for the AI Copilot service."""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.copilot.agent import CopilotAgent
from app.copilot.models import (
    ApprovalAssistanceRequest,
    CopilotAction,
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

router = APIRouter(prefix="/copilot", tags=["copilot"])


def get_agent(request: Request) -> CopilotAgent:
    agent = getattr(request.app.state, "copilot_agent", None)
    if agent is None:
        agent = CopilotAgent()
        request.app.state.copilot_agent = agent
    return agent


def security_context(
    x_tenant_id: str = Header(default=""),
    x_user_id: str = Header(default=""),
    x_user_role: str = Header(default=""),
    x_user_permissions: str = Header(default=""),
    x_ai_service_token: str = Header(default=""),
    x_correlation_id: str = Header(default=""),
    authorization: str = Header(default=""),
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
    )


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
    return await agent.run(
        CopilotRequest(
            message=body.description or body.title,
            action=CopilotAction.APPROVAL_ASSISTANCE,
            context={
                "workflowInstanceId": body.workflow_instance_id,
                "title": body.title,
                "description": body.description,
                "assigneeId": body.assignee_id,
            },
            confirm_high_risk=True,
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
    )

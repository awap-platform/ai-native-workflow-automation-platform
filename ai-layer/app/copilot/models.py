"""Typed contracts shared by the Copilot agent, tools and HTTP API."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class CopilotAction(StrEnum):
    """High-level copilot intents accepted by the service."""

    CHAT = "chat"
    DISCOVER_WORKFLOW = "discover_workflow"
    START_WORKFLOW = "start_workflow"
    QUERY_TASKS = "query_tasks"
    COMPLETE_TASK = "complete_task"
    ASSIGN_TASK = "assign_task"
    SEND_NOTIFICATION = "send_notification"
    APPROVAL_ASSISTANCE = "approval_assistance"
    KNOWLEDGE_SEARCH = "knowledge_search"


class SecurityContext(BaseModel):
    """Caller context carried from the backend to every tool invocation.

    The routing fields are server-derived budget/latency metadata set by the backend from its
    authoritative budget service; they are never read from the SPA request body.
    """

    tenant_id: str
    user_id: str
    role: str
    permissions: list[str] = Field(default_factory=list)
    correlation_id: str = ""
    access_token: str | None = None
    remaining_budget_tokens: int | None = None
    latency_budget_ms: int | None = None
    task_risk: str | None = None


class CopilotRequest(BaseModel):
    """One natural-language request."""

    message: str = Field(min_length=1, max_length=8_000)
    action: CopilotAction | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, max_length=255)
    confirm_high_risk: bool = False


class ToolCall(BaseModel):
    """A tool invocation that was executed or proposed by the agent."""

    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: Any = None
    ok: bool = True
    error: str | None = None


class Citation(BaseModel):
    """A tenant document chunk that supports an answer.

    Citations are structured so the SPA can render source cards and so an answer without any source
    can be flagged instead of being presented as a confident fact.
    """

    index: int
    title: str
    document_id: str
    chunk_index: int = 0
    score: float | None = None


class BudgetUsage(BaseModel):
    """Token/cost usage reported for one Copilot request.

    ``remaining_tokens`` comes from the backend-supplied routing metadata when present and falls
    back to the gateway's tenant ledger. A missing value means the deployment did not report a
    budget; it must never be rendered as "unlimited".
    """

    remaining_tokens: int | None = None
    monthly_budget_tokens: int | None = None
    used_tokens: int | None = None
    estimated_cost_micros: int | None = None


class CopilotWarning(BaseModel):
    """User-facing guardrail or data-handling warning attached to a response."""

    code: str
    message: str
    severity: Literal["info", "warning", "error"] = "warning"


class GuardrailSummary(BaseModel):
    """The winning semantic-guardrail decision for one request."""

    policy: str | None = None
    decision: str = "allow"
    score: float = 0.0
    version: str = ""
    unavailable: bool = False


class CopilotAudit(BaseModel):
    """Per-request audit record rendered by the SPA.

    ``request_id`` is stable for a logical request (the idempotency key when supplied, otherwise the
    correlation ID), which lets the UI deduplicate a replayed response into a single audit entry.
    """

    request_id: str
    action: str
    outcome: str | None = None
    confidence: float = 0.0
    requires_human_approval: bool = False
    tool_calls: list[ToolCall] = Field(default_factory=list)
    idempotency_key: str | None = None
    correlation_id: str = ""
    prompt_key: str = ""
    prompt_version: str = ""
    prompt_hash: str = ""
    model: str | None = None
    model_tier: str | None = None
    routing_reason: str | None = None
    proposal_id: str | None = None
    proposal_hash: str | None = None
    decision: str | None = None
    retrieved_document_ids: list[str] = Field(default_factory=list)


class CopilotResponse(BaseModel):
    """Stable response envelope for every copilot endpoint."""

    answer: str
    action: CopilotAction
    confidence: float = Field(ge=0.0, le=1.0)
    requires_human_approval: bool = False
    tool_calls: list[ToolCall] = Field(default_factory=list)
    data: Any = None
    model: str | None = None
    model_tier: str | None = None
    routing_reason: str | None = None
    routing_policy: str | None = None
    estimated_cost_micros: int | None = None
    prompt_key: str
    prompt_version: str
    prompt_hash: str
    correlation_id: str
    idempotency_key: str | None = None
    cache_hit: bool = False
    provider: str | None = None
    fallback_reason: str | None = None
    outcome: str | None = None
    citations: list[Citation] = Field(default_factory=list)
    budget: BudgetUsage = Field(default_factory=BudgetUsage)
    warnings: list[CopilotWarning] = Field(default_factory=list)
    guardrail: GuardrailSummary = Field(default_factory=GuardrailSummary)
    audit: CopilotAudit | None = None


class WorkflowDiscoveryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2_000)


class WorkflowInitiationRequest(BaseModel):
    workflow_id: str
    context: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None
    confirm_high_risk: bool = False


class TaskCompletionRequest(BaseModel):
    # The path parameter is authoritative; the body field is optional for backward compatibility.
    task_id: str | None = None
    decision: Literal["approve", "reject", "complete"] = "complete"
    comment: str | None = Field(default=None, max_length=2_000)
    confirm_high_risk: bool = False


class ApprovalAssistanceRequest(BaseModel):
    """Two-step approval request (issue #296).

    The first call proposes an approval and returns a tenant-scoped ``proposal_id`` plus a payload
    hash. Nothing is created until a second call sets ``confirm`` and presents the same proposal id
    and hash with an identical payload.
    """

    workflow_instance_id: str
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    assignee_id: str | None = None
    confirm: bool = False
    proposal_id: str | None = Field(default=None, max_length=128)
    proposal_hash: str | None = Field(default=None, max_length=64)
    idempotency_key: str | None = Field(default=None, max_length=255)


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2_000)
    limit: int = Field(default=10, ge=1, le=50)


class PromptDescriptor(BaseModel):
    key: str
    version: str
    path: str
    sha256: str


class MetricsResponse(BaseModel):
    counters: dict[str, int]
    prompt_version: str
    prompt_hashes: dict[str, str] = Field(default_factory=dict)
    latencies: dict[str, dict[str, float | int]] = Field(default_factory=dict)


class JobStatusResponse(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class CopilotJobResponse(BaseModel):
    id: str
    status: JobStatusResponse
    result: CopilotResponse | None = None
    error: str | None = None
    prompt_version: str
    prompt_hash: str | None = None
    queue_wait_ms: float | None = None
    created_at: float
    updated_at: float

"""LangGraph-backed Copilot agent.

LangGraph owns only the agent's internal planning state. Business workflow state remains exclusively
in the Java Workflow Engine; the agent can only request state changes through audited backend tools.
This boundary is what prevents the split-brain failure mode (C5).
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, TypedDict

import httpx

from app.copilot.guardrails import (
    GuardrailViolation,
    estimate_confidence,
    sanitize_input,
    sanitize_output,
)
from app.copilot.knowledge import (
    DEFAULT_MIN_HITS,
    DEFAULT_MIN_SCORE,
    LOW_CONFIDENCE,
    NO_ANSWER,
    SEARCH_UNAVAILABLE,
    SUCCESS,
    assess_hits,
    summarize_hits,
    unavailable,
)
from app.copilot.llm_gateway import LlmGateway, LlmUnavailable
from app.copilot.metrics import CopilotMetrics
from app.copilot.models import (
    BudgetUsage,
    Citation,
    CopilotAction,
    CopilotAudit,
    CopilotRequest,
    CopilotResponse,
    CopilotWarning,
    GuardrailSummary,
    SecurityContext,
    ToolCall,
)
from app.copilot.prompts import (
    PROMPT_VERSION,
    prompt_for_action,
    prompt_hash,
    prompt_key_for_action,
)
from app.copilot.proposals import (
    CONFIRMED,
    PROPOSED,
    ApprovalProposalStore,
    payload_hash,
)
from app.copilot.response_cache import ResponseCache
from app.copilot.routing import ModelRouter
from app.copilot.semantic_guardrails import SemanticGuardrailLayer
from app.copilot.tools import ToolRegistry

try:  # pragma: no cover - exercised only when the pinned dependency is installed
    from langgraph.graph import END, StateGraph

    LANGGRAPH_AVAILABLE = True
except Exception:  # pragma: no cover - deterministic fallback keeps the service usable
    END = "__end__"
    StateGraph = None  # type: ignore[assignment]
    LANGGRAPH_AVAILABLE = False


CACHEABLE_ACTIONS = {CopilotAction.CHAT}

HIGH_RISK_ACTIONS = {
    CopilotAction.START_WORKFLOW,
    CopilotAction.COMPLETE_TASK,
    CopilotAction.ASSIGN_TASK,
    CopilotAction.SEND_NOTIFICATION,
    CopilotAction.APPROVAL_ASSISTANCE,
}

NOTIFICATION_CHANNELS = {"EMAIL", "SMS", "PUSH", "WEB", "WEBHOOK"}
NOTIFICATION_TEMPLATES = {
    "notification",
    "welcome",
    "task-assigned",
    "task-approved",
    "task-rejected",
    "task-completed",
    "task-escalated",
    "workflow-started",
    "workflow-completed",
    "workflow-failed",
    "workflow-paused",
    "workflow-resumed",
}
NOTIFICATION_LOCALES = {"en", "tr"}


class AgentState(TypedDict, total=False):
    message: str
    action: CopilotAction
    context: dict[str, Any]
    security: SecurityContext
    idempotency_key: str | None
    confirm_high_risk: bool
    proposal: dict[str, Any]
    guardrail: dict[str, Any]
    retrieved: dict[str, Any]
    prompt: str
    prompt_key: str
    prompt_hash: str
    route: dict[str, Any]
    tool_calls: list[dict[str, Any]]
    warnings: list[dict[str, str]]
    citations: list[dict[str, Any]]
    data: Any
    answer: str
    confidence: float
    requires_human_approval: bool
    outcome: str
    llm_usage: Any
    provider: str | None
    fallback_reason: str | None


class LlmClient:
    """Provider-agnostic OpenAI-compatible chat client; optional in every environment."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout_seconds: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("AI_COPILOT_LLM_BASE_URL", "")).rstrip("/")
        self.api_key = api_key or os.getenv("AI_COPILOT_LLM_API_KEY", "")
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    async def complete(self, prompt: str, user_message: str, model: str) -> str | None:
        if not self.configured:
            return None
        payload = {
            "model": model,
            "temperature": 0.1,
            "max_tokens": 700,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_message},
            ],
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout_seconds, transport=self.transport
            ) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions", json=payload, headers=headers
                )
            if response.status_code >= 400:
                return None
            content = response.json().get("choices", [{}])[0].get("message", {}).get("content")
            return content if isinstance(content, str) and content.strip() else None
        except Exception:
            return None


class CopilotAgent:
    def __init__(
        self,
        tools: ToolRegistry | None = None,
        router: ModelRouter | None = None,
        llm: LlmClient | None = None,
        metrics: CopilotMetrics | None = None,
        confidence_threshold: float | None = None,
        knowledge_min_score: float | None = None,
        knowledge_min_hits: int | None = None,
        response_cache: ResponseCache | None = None,
        llm_gateway: LlmGateway | None = None,
        approval_proposals: ApprovalProposalStore | None = None,
        semantic_guardrails: SemanticGuardrailLayer | None = None,
    ) -> None:
        self.tools = tools or ToolRegistry()
        self.router = router or ModelRouter()
        self.llm = llm or LlmClient()
        self.metrics = metrics or CopilotMetrics()
        self.semantic_guardrails = semantic_guardrails or SemanticGuardrailLayer()
        self.approval_proposals = (
            approval_proposals
            if approval_proposals is not None
            else ApprovalProposalStore(
                ttl_seconds=float(os.getenv("AI_APPROVAL_PROPOSAL_TTL_SECONDS", "900")),
                max_entries=int(os.getenv("AI_APPROVAL_PROPOSAL_MAX_ENTRIES", "1000")),
            )
        )
        self.llm_gateway = llm_gateway or LlmGateway(
            primary=self.llm,
            metrics=self.metrics,
            monthly_budget_tokens=int(os.getenv("AI_LLM_MONTHLY_BUDGET_TOKENS", "1000000")),
            per_minute_limit=int(os.getenv("AI_LLM_RATE_LIMIT_PER_MINUTE", "60")),
            cache_ttl_seconds=float(os.getenv("AI_LLM_CACHE_TTL_SECONDS", "30")),
            cache_max_entries=int(os.getenv("AI_LLM_CACHE_MAX_ENTRIES", "256")),
            cost_micros_per_token=int(os.getenv("AI_LLM_COST_MICROS_PER_TOKEN", "2")),
            max_output_tokens=int(os.getenv("AI_LLM_MAX_OUTPUT_TOKENS", "1024")),
        )
        self.cache = response_cache or ResponseCache(
            ttl_seconds=float(os.getenv("AI_RESPONSE_CACHE_TTL_SECONDS", "30"))
        )
        self.confidence_threshold = (
            confidence_threshold
            if confidence_threshold is not None
            else float(os.getenv("AI_CONFIDENCE_THRESHOLD", "0.7"))
        )
        self.knowledge_min_score = (
            knowledge_min_score
            if knowledge_min_score is not None
            else float(os.getenv("AI_KNOWLEDGE_MIN_SCORE", str(DEFAULT_MIN_SCORE)))
        )
        self.knowledge_min_hits = (
            knowledge_min_hits
            if knowledge_min_hits is not None
            else int(os.getenv("AI_KNOWLEDGE_MIN_HITS", str(DEFAULT_MIN_HITS)))
        )
        self.graph = self._build_graph()

    # ------------------------------------------------------------------ graph
    def _build_graph(self):
        if not LANGGRAPH_AVAILABLE or StateGraph is None:
            return None
        graph = StateGraph(AgentState)
        graph.add_node("classify", self._classify)
        graph.add_node("plan", self._plan)
        graph.add_node("act", self._act)
        graph.add_node("finalize", self._finalize)
        graph.set_entry_point("classify")
        graph.add_edge("classify", "plan")
        graph.add_edge("plan", "act")
        graph.add_edge("act", "finalize")
        graph.add_edge("finalize", END)
        return graph.compile()

    async def run(self, request: CopilotRequest, security: SecurityContext) -> CopilotResponse:
        started = time.perf_counter()
        cache_key = self._cache_key(request, security)
        if cache_key is not None:
            cached = self.cache.get(cache_key)
            if cached is not None:
                self.metrics.increment("copilot.cache.hit")
                self.metrics.observe(
                    "copilot.request.duration",
                    (time.perf_counter() - started) * 1_000,
                    tier=cached.model_tier or "none",
                    action=cached.action.value,
                    outcome="CACHE_HIT",
                    cache_hit="true",
                )
                return cached.model_copy(
                    update={
                        "correlation_id": security.correlation_id,
                        "idempotency_key": request.idempotency_key,
                        "cache_hit": True,
                    }
                )
        state: AgentState = {
            "message": request.message,
            "context": request.context,
            "security": security,
            "idempotency_key": request.idempotency_key,
            "confirm_high_risk": request.confirm_high_risk,
            "tool_calls": [],
            "warnings": [],
            "citations": [],
            "prompt_key": "chat",
            "prompt_hash": prompt_hash("chat"),
        }
        if request.action is not None:
            state["action"] = request.action

        if self.graph is not None:
            final = await self.graph.ainvoke(state)
        else:
            for step in (self._classify, self._plan, self._act, self._finalize):
                state = await step(state)  # type: ignore[assignment]
            final = state

        outcome = "HITL" if final.get("requires_human_approval") else "SUCCESS"
        self.metrics.observe(
            "copilot.request.duration",
            (time.perf_counter() - started) * 1_000,
            tier=final.get("route", {}).get("tier") or "none",
            action=final.get("action", CopilotAction.CHAT).value,
            outcome=outcome,
            cache_hit="false",
        )
        route = final.get("route", {})
        proposal = final.get("proposal") or {}
        retrieved = final.get("retrieved") or {}
        tool_calls = [ToolCall(**call) for call in final.get("tool_calls", [])]
        citations = [Citation(**citation) for citation in final.get("citations", [])]
        warnings = [CopilotWarning(**warning) for warning in final.get("warnings", [])]
        guardrail_fields = final.get("guardrail") or {}
        guardrail = GuardrailSummary(
            policy=guardrail_fields.get("guardrailPolicy"),
            decision=guardrail_fields.get("guardrailDecision") or "allow",
            score=float(guardrail_fields.get("guardrailScore") or 0.0),
            version=str(guardrail_fields.get("guardrailVersion") or ""),
            unavailable=bool(guardrail_fields.get("guardrailUnavailable") or False),
        )
        budget = self._budget_usage(security, route, final.get("llm_usage"))
        derived_request_id = (
            f"{security.tenant_id}:{final.get('prompt_hash', '')}:"
            f"{final.get('action', CopilotAction.CHAT).value}"
        )
        request_id = (
            request.idempotency_key or security.correlation_id or derived_request_id
        )
        audit = CopilotAudit(
            request_id=request_id,
            action=final.get("action", CopilotAction.CHAT).value,
            outcome=final.get("outcome"),
            confidence=final["confidence"],
            requires_human_approval=final.get("requires_human_approval", False),
            tool_calls=tool_calls,
            idempotency_key=request.idempotency_key,
            correlation_id=security.correlation_id,
            prompt_key=final.get("prompt_key", "chat"),
            prompt_version=PROMPT_VERSION,
            prompt_hash=final.get("prompt_hash", prompt_hash("chat")),
            model=route.get("model"),
            model_tier=route.get("tier"),
            routing_reason=route.get("routingReason"),
            proposal_id=proposal.get("proposalId"),
            proposal_hash=proposal.get("proposalHash"),
            decision=proposal.get("decision"),
            retrieved_document_ids=retrieved.get("documentIds") or [],
        )
        response = CopilotResponse(
            answer=final["answer"],
            action=final["action"],
            confidence=final["confidence"],
            requires_human_approval=final.get("requires_human_approval", False),
            tool_calls=tool_calls,
            data=final.get("data"),
            model=route.get("model"),
            model_tier=route.get("tier"),
            routing_reason=route.get("routingReason"),
            routing_policy=route.get("routingPolicy"),
            estimated_cost_micros=route.get("estimatedCostMicros"),
            prompt_key=final.get("prompt_key", "chat"),
            prompt_version=PROMPT_VERSION,
            prompt_hash=final.get("prompt_hash", prompt_hash("chat")),
            correlation_id=security.correlation_id,
            idempotency_key=request.idempotency_key,
            provider=final.get("provider"),
            fallback_reason=final.get("fallback_reason"),
            outcome=final.get("outcome"),
            citations=citations,
            budget=budget,
            warnings=warnings,
            guardrail=guardrail,
            audit=audit,
        )
        if cache_key is not None:
            self.metrics.increment("copilot.cache.miss")
            self.cache.put(cache_key, response)
        return response

    def _cache_key(self, request: CopilotRequest, security: SecurityContext) -> str | None:
        """Only explicit read-only chat requests are cacheable.

        State-changing requests, high-risk confirmations, request-scoped context and idempotent
        submissions must always execute so the cache can never change an outcome.
        """
        if not self.cache.enabled or request.action not in CACHEABLE_ACTIONS:
            return None
        if request.context or request.confirm_high_risk or request.idempotency_key:
            return None
        prompt_key = prompt_key_for_action(request.action.value)
        return (
            f"{security.tenant_id}:{security.user_id}:{prompt_key}:"
            f"{prompt_hash(prompt_key)}:{request.message}"
        )

    # ------------------------------------------------------------------ nodes
    async def _classify(self, state: AgentState) -> AgentState:
        if state.get("action"):
            return state
        message = state["message"].lower()
        if any(
            word in message
            for word in ("başlat", "start", "initiate", "izin talebi", "leave request")
        ):
            action = CopilotAction.START_WORKFLOW
        # Assignment and notification are matched before the generic task/approval words:
        # "notify the approver" must never be mistaken for an approval decision.
        elif any(word in message for word in ("assign", "görevlendir", "devret", "ata")):
            action = CopilotAction.ASSIGN_TASK
        elif any(
            word in message
            for word in (
                "notify",
                "notification",
                "bildir",
                "bildirim",
                "haber ver",
                "hatırlat",
                "remind",
            )
        ):
            action = CopilotAction.SEND_NOTIFICATION
        elif any(
            word in message
            for word in ("onayla", "approve", "reddet", "reject", "tamamla", "complete task")
        ):
            action = CopilotAction.COMPLETE_TASK
        elif any(word in message for word in ("onay", "approval", "assist")):
            action = CopilotAction.APPROVAL_ASSISTANCE
        elif any(word in message for word in ("görev", "task", "işlerim", "my tasks")):
            action = CopilotAction.QUERY_TASKS
        elif any(
            word in message
            for word in ("belge", "doküman", "document", "search", "ara", "bul", "knowledge")
        ):
            action = CopilotAction.KNOWLEDGE_SEARCH
        else:
            action = CopilotAction.CHAT
        state["action"] = action
        self.metrics.increment(f"copilot.intent.{action.value}")
        return state

    async def _plan(self, state: AgentState) -> AgentState:
        action = state.get("action", CopilotAction.CHAT)
        high_risk = action in HIGH_RISK_ACTIONS
        report = self.semantic_guardrails.screen_input(state["message"], action.value, high_risk)
        state["guardrail"] = report.audit_fields()
        if report.unavailable:
            self._warn(
                state,
                "GUARDRAIL_UNAVAILABLE",
                "The semantic guardrail classifier was unavailable. High-risk actions fail closed.",
                "warning",
            )
        if report.blocked:
            top = report.top
            state["answer"] = (
                "I cannot process this request because it violates the configured safety policy "
                "(prompt-injection or guardrail block). No tool was called."
            )
            state["confidence"] = 0.0
            state["requires_human_approval"] = False
            state["outcome"] = "GUARDRAIL_BLOCKED"
            state["data"] = {
                "errorCode": "GUARDRAIL_BLOCKED",
                "policy": top.policy.value if top else None,
            }
            self._warn(
                state,
                f"GUARDRAIL_{top.policy.value.upper()}_BLOCKED" if top else "GUARDRAIL_BLOCKED",
                "The request was blocked by the safety policy and no tool was called.",
                "error",
            )
            self.metrics.increment("copilot.guardrail.semantic_input_blocked")
            return state
        if report.redacted and report.redacted_text is not None:
            state["message"] = report.redacted_text
            self._warn(
                state,
                "PII_REDACTED",
                "Personal data in the request was redacted before it reached the model.",
                "warning",
            )
            self.metrics.increment("copilot.guardrail.semantic_input_redacted")
        try:
            sanitized = sanitize_input(state["message"])
            state["message"] = sanitized.text
            if sanitized.sanitized:
                self._warn(
                    state,
                    "INPUT_NORMALIZED",
                    "Zero-width characters or extra whitespace were removed from the request.",
                    "info",
                )
                self.metrics.increment("copilot.guardrail.input_sanitized")
        except GuardrailViolation as ex:
            state["answer"] = str(ex)
            state["confidence"] = 0.0
            state["requires_human_approval"] = False
            state["action"] = state.get("action", CopilotAction.CHAT)
            state["outcome"] = "GUARDRAIL_BLOCKED"
            self._warn(state, "INPUT_BLOCKED", str(ex), "error")
            self.metrics.increment("copilot.guardrail.input_blocked")
            return state

        action = state.get("action", CopilotAction.CHAT)
        security = state["security"]
        decision = self.router.route(
            state["message"],
            action,
            latency_budget_ms=(
                security.latency_budget_ms if security.latency_budget_ms is not None else 10_000
            ),
            remaining_budget_tokens=security.remaining_budget_tokens,
            risk=security.task_risk,
        )
        state["route"] = {
            "tier": decision.tier.value,
            "model": decision.model,
            "complexity": decision.complexity,
            "reason": decision.reason,
            **decision.as_audit(),
        }
        prompt_key = prompt_key_for_action(action.value)
        state["prompt_key"] = prompt_key
        state["prompt_hash"] = prompt_hash(prompt_key)
        state["prompt"] = prompt_for_action(action.value)
        self.metrics.increment(f"copilot.route.{decision.tier.value}")
        return state

    async def _act(self, state: AgentState) -> AgentState:
        if state.get("answer"):
            return state
        action = state.get("action", CopilotAction.CHAT)
        high_risk = action in HIGH_RISK_ACTIONS
        tool_report = self.semantic_guardrails.screen_tool_intent(
            state["message"], action.value, high_risk
        )
        state["guardrail"] = tool_report.audit_fields()
        if tool_report.blocked:
            top = tool_report.top
            state["answer"] = (
                "I cannot perform that tool action because it violates the tool-use policy. "
                "No domain tool was called."
            )
            state["confidence"] = 0.0
            state["requires_human_approval"] = False
            state["outcome"] = "GUARDRAIL_TOOL_BLOCKED"
            state["data"] = {
                "errorCode": "GUARDRAIL_TOOL_BLOCKED",
                "policy": top.policy.value if top else None,
            }
            self._warn(
                state,
                "TOOL_USE_BLOCKED",
                "The requested tool action violated the tool-use policy; "
                "no domain tool was called.",
                "error",
            )
            self.metrics.increment("copilot.guardrail.semantic_tool_blocked")
            return state
        try:
            if action == CopilotAction.START_WORKFLOW:
                return await self._start_workflow(state)
            if action == CopilotAction.DISCOVER_WORKFLOW:
                return await self._discover_workflow(state)
            if action == CopilotAction.QUERY_TASKS:
                return await self._query_tasks(state)
            if action == CopilotAction.COMPLETE_TASK:
                return await self._complete_task(state)
            if action == CopilotAction.ASSIGN_TASK:
                return await self._assign_task(state)
            if action == CopilotAction.SEND_NOTIFICATION:
                return await self._send_notification(state)
            if action == CopilotAction.APPROVAL_ASSISTANCE:
                return await self._approval_assistance(state)
            if action == CopilotAction.KNOWLEDGE_SEARCH:
                return await self._knowledge_search(state)
            return await self._chat(state)
        except GuardrailViolation as ex:
            state["answer"] = str(ex)
            state["confidence"] = 0.0
            state["requires_human_approval"] = False
            state["outcome"] = "GUARDRAIL_BLOCKED"
            self._warn(state, "ACTION_BLOCKED", str(ex), "error")
            self.metrics.increment("copilot.guardrail.action_blocked")
            return state

    async def _finalize(self, state: AgentState) -> AgentState:
        raw_answer = state.get("answer")
        if raw_answer is None or not str(raw_answer).strip():
            answer = (
                "I don't know. I could not produce an answer from the available tenant "
                "information, so I will not guess."
            )
            state["requires_human_approval"] = True
            state["outcome"] = state.get("outcome") or "NO_ANSWER"
            self._warn(
                state,
                "NO_ANSWER",
                "No grounded answer was produced; human review is required.",
                "warning",
            )
            self.metrics.increment("copilot.no_answer.empty")
        else:
            answer = str(raw_answer)
        action = state.get("action", CopilotAction.CHAT)
        high_risk = action in HIGH_RISK_ACTIONS
        output_report = self.semantic_guardrails.screen_output(answer, action.value, high_risk)
        # Preserve the input/tool block in the audit row instead of replacing it with the
        # (harmless) canned response's output assessment.
        if state.get("outcome") not in {"GUARDRAIL_BLOCKED", "GUARDRAIL_TOOL_BLOCKED"}:
            state["guardrail"] = output_report.audit_fields()
        if output_report.unavailable:
            self._warn(
                state,
                "GUARDRAIL_UNAVAILABLE",
                "The semantic guardrail classifier was unavailable for this response.",
                "warning",
            )
        if output_report.blocked:
            answer = (
                "The response was blocked by the semantic guardrails because it violated a "
                "configured policy."
            )
            state["requires_human_approval"] = True
            state["outcome"] = "GUARDRAIL_OUTPUT_BLOCKED"
            self._warn(
                state,
                "OUTPUT_BLOCKED",
                "The model response was blocked by the safety policy.",
                "error",
            )
            self.metrics.increment("copilot.guardrail.semantic_output_blocked")
        elif output_report.redacted and output_report.redacted_text is not None:
            answer = output_report.redacted_text
            self._warn(
                state,
                "OUTPUT_PII_REDACTED",
                "Personal data in the response was redacted.",
                "warning",
            )
            self.metrics.increment("copilot.guardrail.semantic_output_redacted")
        try:
            answer = sanitize_output(answer)
        except GuardrailViolation as ex:
            answer = f"The response was blocked by safety guardrails: {ex}"
            state["requires_human_approval"] = True
            state["outcome"] = "GUARDRAIL_OUTPUT_BLOCKED"
            self._warn(state, "OUTPUT_BLOCKED", str(ex), "error")
            self.metrics.increment("copilot.guardrail.output_blocked")
        state["answer"] = answer
        state["confidence"] = state.get("confidence", estimate_confidence(answer, action.value))
        if state["confidence"] < self.confidence_threshold:
            state["requires_human_approval"] = True
            self._warn(
                state,
                "LOW_CONFIDENCE",
                f"Confidence {state['confidence']:.2f} is below the "
                f"{self.confidence_threshold:.2f} threshold; human review is required.",
                "warning",
            )
            self.metrics.increment("copilot.hitl.low_confidence")

        security = state["security"]
        outcome = state.get("outcome") or (
            "HITL" if state.get("requires_human_approval") else "SUCCESS"
        )
        state["outcome"] = outcome
        proposal = state.get("proposal") or {}
        route = state.get("route", {})
        retrieved = state.get("retrieved") or {}
        audit_payload = {
            "action": action.value,
            "confidence": round(state["confidence"], 4),
            "requiresHumanApproval": state.get("requires_human_approval", False),
            "model": route.get("model"),
            "modelTier": route.get("tier"),
            "routingPolicy": route.get("routingPolicy"),
            "routingReason": route.get("routingReason"),
            "estimatedCostMicros": route.get("estimatedCostMicros"),
            "remainingBudgetTokens": route.get("remainingBudgetTokens"),
            "latencyBudgetMs": route.get("latencyBudgetMs"),
            "promptKey": state.get("prompt_key", "chat"),
            "promptVersion": PROMPT_VERSION,
            "promptHash": state.get("prompt_hash", prompt_hash("chat")),
            "tools": [call["name"] for call in state.get("tool_calls", [])],
            "provider": state.get("provider"),
            "fallbackReason": state.get("fallback_reason"),
            "llmTokens": _llm_tokens(state),
            "llmCostMicros": _llm_cost(state),
            "cacheHit": _llm_cached(state),
            "outcome": outcome,
            **state.get("guardrail", {}),
            "proposalId": proposal.get("proposalId"),
            "proposalHash": proposal.get("proposalHash"),
            "decision": proposal.get("decision"),
            "retrievedDocumentIds": retrieved.get("documentIds"),
            "retrievedChunkRefs": retrieved.get("chunkRefs"),
            "knowledgePromptKey": retrieved.get("promptKey"),
            "knowledgePromptVersion": retrieved.get("promptVersion"),
            "summaryTruncated": retrieved.get("truncated"),
        }
        audit = await self.tools.invoke("audit_decision", audit_payload, security)
        state.setdefault("tool_calls", []).append(audit.model_dump())
        self.metrics.increment("copilot.requests")
        return state

    # ------------------------------------------------------------------ intent handlers
    async def _discover_workflow(self, state: AgentState) -> AgentState:
        security = state["security"]
        call = await self.tools.invoke("find_workflow", {"query": state["message"]}, security)
        return self._record(state, call, self._workflow_answer(call))

    async def _start_workflow(self, state: AgentState) -> AgentState:
        security = state["security"]
        direct_id = state.get("context", {}).get("workflowId")
        if direct_id:
            workflow_id = str(direct_id)
            discovery = ToolCall(name="find_workflow", ok=True, result={"id": workflow_id})
        else:
            discovery = await self.tools.invoke(
                "find_workflow", {"query": state["message"]}, security
            )
            state.setdefault("tool_calls", []).append(discovery.model_dump())
            if not discovery.ok or not discovery.result:
                return self._record(
                    state, discovery, "I could not find a workflow that matches this request."
                )
            workflow_id = self._first_workflow_id(discovery.result)
            if not workflow_id:
                return self._record(state, discovery, "No published workflow matches this request.")
        if not state.get("confirm_high_risk"):
            state["data"] = {"workflowId": workflow_id, "proposedAction": "start_workflow"}
            state["requires_human_approval"] = True
            state["confidence"] = 0.82
            state["answer"] = (
                "I found a matching workflow. Confirm that you want me to start it; I will not "
                "start a process without explicit confirmation."
            )
            return state
        call = await self.tools.invoke(
            "create_workflow_instance",
            {
                "workflowId": workflow_id,
                "context": state.get("context", {}),
                "idempotencyKey": state.get("idempotency_key"),
            },
            security,
            state.get("idempotency_key"),
        )
        state["idempotency_key"] = state.get("idempotency_key")
        answer = (
            "The workflow was started. "
            if call.ok
            else f"The workflow could not be started: {call.error}"
        )
        return self._record(state, call, answer, data=call.result)

    async def _query_tasks(self, state: AgentState) -> AgentState:
        call = await self.tools.invoke("query_tasks", {"mine": True}, state["security"])
        if not call.ok:
            return self._record(state, call, f"I could not query tasks: {call.error}")
        tasks = call.result if isinstance(call.result, list) else []
        if not tasks:
            return self._record(state, call, "You have no open tasks.", data=tasks)
        lines = [
            f"- {task.get('title', task.get('id', 'task'))} [{task.get('status', 'UNKNOWN')}]"
            for task in tasks[:10]
            if isinstance(task, dict)
        ]
        return self._record(
            state,
            call,
            "Your tasks:\n" + "\n".join(lines),
            data=tasks,
        )

    async def _complete_task(self, state: AgentState) -> AgentState:
        task_id = state.get("context", {}).get("taskId")
        decision = state.get("context", {}).get("decision", "complete")
        if not task_id:
            return self._invalid_action(
                state,
                "complete_task",
                "taskId is required",
                "Tell me which task to complete, or open it from the task list first.",
            )
        if decision not in {"approve", "reject", "complete"}:
            return self._invalid_action(
                state,
                "complete_task",
                f"unknown decision: {decision}",
                "That task decision is not supported. Use approve, reject or complete.",
            )
        if not state.get("confirm_high_risk"):
            state["requires_human_approval"] = True
            state["confidence"] = 0.8
            state["data"] = {"taskId": task_id, "decision": decision}
            state["answer"] = (
                "This task decision changes business state. Confirm and I will submit it with "
                "your comment."
            )
            return state
        call = await self.tools.invoke(
            "complete_task",
            {
                "taskId": task_id,
                "decision": decision,
                "comment": state.get("context", {}).get("comment"),
                "idempotencyKey": state.get("idempotency_key"),
            },
            state["security"],
            state.get("idempotency_key"),
        )
        answer = (
            f"Task decision submitted: {decision}."
            if call.ok
            else f"The task decision failed: {call.error}"
        )
        return self._record(
            state,
            call,
            answer,
            data=call.result,
            outcome=None if call.ok else "TOOL_FAILED",
        )

    async def _assign_task(self, state: AgentState) -> AgentState:
        """Resolve one tenant user, then assign only after explicit confirmation (issue #297)."""
        context = state.get("context", {})
        task_id = context.get("taskId")
        if not task_id:
            return self._invalid_action(
                state,
                "assign_task",
                "taskId is required",
                "Tell me which task to assign, or open it from the task list first.",
            )
        security = state["security"]
        assignee_id = context.get("assigneeId")
        resolved: dict[str, Any] | None = None
        if not assignee_id:
            query = (
                context.get("assigneeEmail")
                or context.get("assigneeName")
                or context.get("assignee")
            )
            if not query:
                state["requires_human_approval"] = True
                state["confidence"] = 0.4
                state["answer"] = (
                    "Who should the task be assigned to? Give an explicit user id, email or name "
                    "inside your tenant."
                )
                return state
            lookup = await self.tools.invoke(
                "find_user", {"query": str(query)}, security, state.get("idempotency_key")
            )
            state.setdefault("tool_calls", []).append(lookup.model_dump())
            if not lookup.ok:
                return self._record(
                    state,
                    lookup,
                    f"I could not resolve that assignee: {lookup.error}",
                )
            matches = lookup.result if isinstance(lookup.result, list) else []
            if len(matches) != 1 or not isinstance(matches[0], dict):
                state["requires_human_approval"] = True
                state["confidence"] = 0.3
                state["data"] = matches
                state["answer"] = (
                    "I found no unique user in your tenant for that assignee. I will not assign "
                    "the task without an explicit user id."
                    if not matches
                    else "More than one user matches that assignee. Give me the exact user id "
                    "so I do not assign the task to the wrong person."
                )
                return state
            resolved = matches[0]
            assignee_id = resolved.get("id")

        if not state.get("confirm_high_risk"):
            state["requires_human_approval"] = True
            state["confidence"] = 0.8
            state["data"] = {
                "taskId": task_id,
                "assigneeId": assignee_id,
                "assignee": resolved,
                "proposedAction": "assign_task",
            }
            state["answer"] = (
                "Assigning a task changes business state. Confirm that this is the right task and "
                "assignee; I will assign it only after your confirmation."
            )
            return state

        call = await self.tools.invoke(
            "assign_task",
            {
                "taskId": task_id,
                "assigneeId": assignee_id,
                "idempotencyKey": state.get("idempotency_key"),
            },
            security,
            state.get("idempotency_key"),
        )
        assignee_label = (
            resolved.get("fullName") or resolved.get("email")
            if isinstance(resolved, dict)
            else assignee_id
        )
        answer = (
            f"The task was assigned to {assignee_label}."
            if call.ok
            else f"The task could not be assigned: {call.error}"
        )
        return self._record(state, call, answer, data=call.result)

    async def _send_notification(self, state: AgentState) -> AgentState:
        """Validate, dedupe and confirm a notification before sending it (issue #297)."""
        context = state.get("context", {})
        recipient = (
            context.get("recipient") or context.get("recipientEmail") or context.get("recipientId")
        )
        if not recipient:
            return self._invalid_action(
                state,
                "send_notification",
                "recipient is required",
                "Who should receive the notification? Give an explicit tenant user or address.",
            )
        channel = str(context.get("channel") or "EMAIL").upper()
        if channel not in NOTIFICATION_CHANNELS:
            return self._invalid_action(
                state,
                "send_notification",
                f"unknown channel: {channel}",
                "That notification channel is not supported. Use EMAIL, SMS, PUSH, WEB or WEBHOOK.",
            )
        template_key = str(context.get("templateKey") or "notification")
        if template_key not in NOTIFICATION_TEMPLATES:
            return self._invalid_action(
                state,
                "send_notification",
                f"unknown templateKey: {template_key}",
                "That notification template is not registered. Pick a known template before "
                "I send.",
            )
        locale = str(context.get("locale") or "en").lower()
        if locale not in NOTIFICATION_LOCALES:
            return self._invalid_action(
                state,
                "send_notification",
                f"unsupported locale: {locale}",
                "That notification locale is not supported. Use en or tr.",
            )

        payload = {
            "recipient": str(recipient),
            "channel": channel,
            "templateKey": template_key,
            "locale": locale,
            "variables": context.get("variables") or {},
            "businessKey": context.get("businessKey"),
            # The idempotency key also dedupes the durable notification delivery.
            "dedupeKey": context.get("dedupeKey") or state.get("idempotency_key"),
        }
        if not state.get("confirm_high_risk"):
            state["requires_human_approval"] = True
            state["confidence"] = 0.8
            state["data"] = {**payload, "proposedAction": "send_notification"}
            state["answer"] = (
                "Sending a notification changes external state. Confirm the recipient, channel, "
                "template and locale; I will send it only after your confirmation."
            )
            return state

        call = await self.tools.invoke(
            "send_notification",
            {**payload, "idempotencyKey": state.get("idempotency_key")},
            state["security"],
            state.get("idempotency_key"),
        )
        answer = (
            "The notification was queued for delivery."
            if call.ok
            else f"The notification could not be sent: {call.error}"
        )
        return self._record(state, call, answer, data=call.result)

    def _invalid_action(
        self, state: AgentState, tool_name: str, error: str, message: str
    ) -> AgentState:
        """Surface a validation failure without invoking a state-changing tool."""
        state["requires_human_approval"] = True
        state["confidence"] = 0.0
        state["data"] = {"errorCode": "VALIDATION_FAILED", "detail": error}
        state["answer"] = message
        state.setdefault("tool_calls", []).append(
            ToolCall(name=tool_name, ok=False, error=error).model_dump()
        )
        self.metrics.increment(f"copilot.tool.validation_failed.{tool_name}")
        return state

    async def _approval_assistance(self, state: AgentState) -> AgentState:
        """Two-step, hash-bound approval creation (issue #296).

        The first call only proposes. No domain tool runs until a second, explicitly confirmed call
        presents the proposal id and payload hash issued by the first response. A mismatched,
        expired, foreign-tenant or previously confirmed proposal never creates a second task.
        """
        context = state.get("context", {})
        workflow_instance_id = context.get("workflowInstanceId")
        if not workflow_instance_id:
            return self._record(
                state,
                ToolCall(name="create_approval", ok=False, error="workflowInstanceId is required"),
                "Open a workflow instance first so I can prepare an approval task.",
            )

        approval_payload = {
            "workflowInstanceId": str(workflow_instance_id),
            "title": context.get("title") or "Copilot approval request",
            "description": context.get("description") or state["message"],
            "assigneeId": context.get("assigneeId"),
        }
        security = state["security"]

        if not state.get("confirm_high_risk"):
            proposal = self.approval_proposals.propose(
                security, approval_payload, state.get("idempotency_key")
            )
            state["proposal"] = proposal.audit_record(PROPOSED)
            state["outcome"] = PROPOSED
            state["requires_human_approval"] = True
            state["confidence"] = 0.82
            state["data"] = {
                "workflowInstanceId": workflow_instance_id,
                "proposedAction": "create_approval",
                "proposalId": proposal.proposal_id,
                "proposalHash": proposal.proposal_hash,
                "expiresAt": proposal.expires_at,
            }
            state["answer"] = (
                "I can create this approval task, but a high-risk action is never auto-confirmed. "
                "Review the title, description and assignee, then confirm with the proposal id "
                "and hash below. Nothing has been created yet."
            )
            self.metrics.increment("copilot.hitl.proposed")
            return state

        proposal_id = context.get("proposalId")
        supplied_hash = context.get("proposalHash")
        if not proposal_id or not supplied_hash:
            return self._reject_proposal(
                state,
                "PROPOSAL_REQUIRED",
                "Confirmation requires the proposal id and payload hash issued by the proposal "
                "step. No approval task was created.",
            )
        proposal = self.approval_proposals.get(
            str(proposal_id), security.tenant_id, security.user_id
        )
        if proposal is None:
            return self._reject_proposal(
                state,
                "PROPOSAL_UNKNOWN_OR_EXPIRED",
                "That approval proposal is unknown, belongs to another caller, or has expired. "
                "No approval task was created; propose the approval again.",
            )
        expected_hash = payload_hash(approval_payload)
        if supplied_hash != proposal.proposal_hash or expected_hash != proposal.proposal_hash:
            return self._reject_proposal(
                state,
                "PROPOSAL_PAYLOAD_MISMATCH",
                "The confirmation does not match the proposed payload. No approval task was "
                "created; propose the approval again.",
            )

        state["proposal"] = proposal.audit_record(CONFIRMED)
        if proposal.status == CONFIRMED:
            state["outcome"] = CONFIRMED
            state["data"] = proposal.result
            state["confidence"] = 0.95
            state["answer"] = (
                "This approval was already confirmed for this proposal; the existing approval "
                "task is reused and no duplicate was created."
            )
            self.metrics.increment("copilot.hitl.confirmed_duplicate")
            return state

        call = await self.tools.invoke(
            "create_approval",
            {
                **approval_payload,
                # The proposal id is the idempotency key: a replayed confirmation can never
                # create a second approval task in the backend.
                "idempotencyKey": proposal.proposal_id,
            },
            security,
            proposal.proposal_id,
        )
        if call.ok:
            self.approval_proposals.mark_confirmed(proposal, call.result)
            state["outcome"] = CONFIRMED
            state["confidence"] = 0.95
            answer = "The approval task was created after explicit confirmation."
        else:
            state["outcome"] = "CONFIRM_FAILED"
            state["requires_human_approval"] = True
            answer = f"The approval task could not be created: {call.error}"
        self.metrics.increment("copilot.hitl.confirmed")
        return self._record(state, call, answer, data=call.result)

    def _reject_proposal(self, state: AgentState, code: str, message: str) -> AgentState:
        """Fail closed without calling any state-changing tool."""
        state["requires_human_approval"] = True
        state["confidence"] = 0.0
        state["outcome"] = code
        state["data"] = {"errorCode": code}
        state["answer"] = message
        self.metrics.increment(f"copilot.hitl.rejected.{code.lower()}")
        return state

    async def _knowledge_search(self, state: AgentState) -> AgentState:
        call = await self.tools.invoke(
            "search_documents",
            {"query": state["message"], "limit": 10},
            state["security"],
        )
        # A failed call or a malformed payload is an outage, not evidence that nothing exists.
        if not call.ok or not isinstance(call.result, list):
            assessment = unavailable()
            self.metrics.increment(f"copilot.knowledge.{assessment.outcome.lower()}")
            return self._record(
                state,
                call,
                "Knowledge search is currently unavailable, so I cannot confirm whether a "
                "tenant document exists. Please retry, or ask a human to check the source.",
                data=None,
                confidence=0.0,
                outcome=SEARCH_UNAVAILABLE,
                requires_human_approval=True,
            )

        # The backend is tenant-scoped; this is a defensive check so a misbehaving adapter cannot
        # inject another tenant's document into the prompt or the summary.
        tenant_id = state["security"].tenant_id
        hits = [
            hit
            for hit in call.result
            if isinstance(hit, dict)
            and (not hit.get("tenantId") or str(hit.get("tenantId")) == tenant_id)
        ]
        summary = summarize_hits(hits, state["message"])
        state["retrieved"] = {
            "documentIds": summary.document_ids,
            "chunkRefs": summary.chunk_refs,
            "truncated": summary.truncated,
            "promptKey": "knowledge_search",
            "promptVersion": PROMPT_VERSION,
        }
        assessment = assess_hits(
            hits,
            state["message"],
            min_score=self.knowledge_min_score,
            min_hits=self.knowledge_min_hits,
            threshold=self.confidence_threshold,
        )
        self.metrics.increment(f"copilot.knowledge.{assessment.outcome.lower()}")
        state["citations"] = summary.sources

        if assessment.outcome == NO_ANSWER:
            answer = (
                "I don't know. I could not find a tenant document that answers this question, "
                "so I will not guess."
            )
            state["citations"] = []
            self._warn(
                state,
                "NO_ANSWER",
                "No tenant document matched the question; the Copilot did not guess.",
                "warning",
            )
            return self._record(
                state,
                call,
                answer,
                data=hits,
                confidence=assessment.confidence,
                outcome=NO_ANSWER,
                requires_human_approval=True,
            )
        if assessment.outcome == LOW_CONFIDENCE:
            titles = ", ".join(
                str(hit.get("title") or hit.get("fileId", "document"))
                for hit in hits[:3]
                if isinstance(hit, dict)
            )
            answer = (
                "I found possibly related tenant documents"
                + (f" ({titles})" if titles else "")
                + ", but their relevance score is below the confidence threshold. I cannot "
                "confirm this answer as a fact; please review the source or ask a human."
            )
            self._warn(
                state,
                "LOW_CONFIDENCE",
                "Retrieved sources were below the confidence threshold; human review is required.",
                "warning",
            )
            return self._record(
                state,
                call,
                answer,
                data=hits,
                confidence=assessment.confidence,
                outcome=LOW_CONFIDENCE,
                requires_human_approval=True,
            )

        return self._record(
            state,
            call,
            summary.answer,
            data=hits,
            confidence=assessment.confidence,
            outcome=SUCCESS,
            requires_human_approval=False,
        )

    async def _chat(self, state: AgentState) -> AgentState:
        user = await self.tools.invoke("get_user", {}, state["security"])
        state.setdefault("tool_calls", []).append(user.model_dump())
        route = state.get("route", {})
        provider_started = time.perf_counter()
        try:
            result = await self.llm_gateway.complete(
                state.get("prompt", ""),
                state["message"],
                route.get("model", "local-heuristic"),
                tenant_id=state["security"].tenant_id,
                prompt_hash=state.get("prompt_hash", ""),
            )
        except LlmUnavailable:
            self.metrics.increment("copilot.llm.unavailable")
            raise
        finally:
            self.metrics.observe(
                "copilot.provider.duration",
                (time.perf_counter() - provider_started) * 1_000,
                model=route.get("model", "local-heuristic"),
            )
        state["provider"] = result.provider
        state["fallback_reason"] = result.fallback_reason
        state["llm_usage"] = result.usage
        llm_call = ToolCall(
            name="llm",
            arguments={
                "provider": result.provider,
                "cached": result.cached,
                "fallbackReason": result.fallback_reason,
            },
            ok=True,
        )
        if result.text:
            return self._record(state, llm_call, result.text)
        name = ""
        if isinstance(user.result, dict):
            name = user.result.get("fullName") or user.result.get("email") or ""
        greeting = f"Hello {name}. " if name else ""
        return self._record(
            state,
            llm_call,
            greeting
            + "I can discover and start workflows, query and complete your tasks, assist with "
            "approvals and search tenant documents. What would you like to do?",
        )

    # ------------------------------------------------------------------ helpers
    def _warn(
        self,
        state: AgentState,
        code: str,
        message: str,
        severity: str = "warning",
    ) -> None:
        """Attach one deduplicated user-facing warning to the response."""
        warnings = state.setdefault("warnings", [])
        if any(existing.get("code") == code for existing in warnings):
            return
        warnings.append({"code": code, "message": message, "severity": severity})

    def _budget_usage(
        self,
        security: SecurityContext,
        route: dict[str, Any],
        usage: Any,
    ) -> BudgetUsage:
        """Report remaining budget without inventing a value when none is configured."""
        snapshot = self.llm_gateway.budget_snapshot(security.tenant_id)
        remaining = security.remaining_budget_tokens
        if remaining is None:
            remaining = snapshot.get("remaining_tokens")
        used = None
        if usage is not None:
            used = int(usage.prompt_tokens) + int(usage.completion_tokens)
        return BudgetUsage(
            remaining_tokens=remaining,
            monthly_budget_tokens=snapshot.get("monthly_budget_tokens"),
            used_tokens=used if used is not None else snapshot.get("used_tokens"),
            estimated_cost_micros=route.get("estimatedCostMicros"),
        )

    def _record(
        self,
        state: AgentState,
        call: ToolCall,
        answer: str,
        data: Any = None,
        confidence: float | None = None,
        outcome: str | None = None,
        requires_human_approval: bool | None = None,
    ) -> AgentState:
        state.setdefault("tool_calls", []).append(call.model_dump())
        state["answer"] = answer
        state["data"] = data if data is not None else call.result
        state["confidence"] = (
            confidence
            if confidence is not None
            else estimate_confidence(answer, state.get("action", CopilotAction.CHAT).value)
        )
        if outcome is not None:
            state["outcome"] = outcome
        if requires_human_approval is not None:
            state["requires_human_approval"] = requires_human_approval
        return state

    def _workflow_answer(self, call: ToolCall) -> str:
        if not call.ok:
            return f"Workflow discovery failed: {call.error}"
        result = call.result
        if isinstance(result, list):
            if not result:
                return "No published workflow matches this request."
            titles = [
                item.get("name") or item.get("id") for item in result[:5] if isinstance(item, dict)
            ]
            return "Matching workflows: " + ", ".join(str(title) for title in titles)
        if isinstance(result, dict):
            return f"Matching workflow: {result.get('name') or result.get('id')}"
        return "No published workflow matches this request."

    @staticmethod
    def _first_workflow_id(result: Any) -> str | None:
        if isinstance(result, list):
            for item in result:
                if isinstance(item, dict) and item.get("id"):
                    return str(item["id"])
        if isinstance(result, dict) and result.get("id"):
            return str(result["id"])
        return None


def build_default_agent() -> CopilotAgent:
    return CopilotAgent()


def _llm_tokens(state: AgentState) -> int:
    usage = state.get("llm_usage")
    return 0 if usage is None else usage.prompt_tokens + usage.completion_tokens


def _llm_cost(state: AgentState) -> int:
    usage = state.get("llm_usage")
    return 0 if usage is None else usage.cost_micros


def _llm_cached(state: AgentState) -> bool:
    usage = state.get("llm_usage")
    return bool(usage is not None and usage.cached)


def format_tool_payload(payload: Any) -> str:
    """Stable JSON rendering used in structured logs."""
    return json.dumps(payload, default=str, sort_keys=True)

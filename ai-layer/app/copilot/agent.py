"""LangGraph-backed Copilot agent.

LangGraph owns only the agent's internal planning state. Business workflow state remains exclusively
in the Java Workflow Engine; the agent can only request state changes through audited backend tools.
This boundary is what prevents the split-brain failure mode (C5).
"""

from __future__ import annotations

import json
import os
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
    unavailable,
)
from app.copilot.metrics import CopilotMetrics
from app.copilot.models import (
    CopilotAction,
    CopilotRequest,
    CopilotResponse,
    SecurityContext,
    ToolCall,
)
from app.copilot.prompts import PROMPT_VERSION, prompt_for_action
from app.copilot.routing import ModelRouter
from app.copilot.tools import ToolRegistry

try:  # pragma: no cover - exercised only when the pinned dependency is installed
    from langgraph.graph import END, StateGraph

    LANGGRAPH_AVAILABLE = True
except Exception:  # pragma: no cover - deterministic fallback keeps the service usable
    END = "__end__"
    StateGraph = None  # type: ignore[assignment]
    LANGGRAPH_AVAILABLE = False


HIGH_RISK_ACTIONS = {
    CopilotAction.START_WORKFLOW,
    CopilotAction.COMPLETE_TASK,
    CopilotAction.APPROVAL_ASSISTANCE,
}


class AgentState(TypedDict, total=False):
    message: str
    action: CopilotAction
    context: dict[str, Any]
    security: SecurityContext
    idempotency_key: str | None
    confirm_high_risk: bool
    prompt: str
    route: dict[str, Any]
    tool_calls: list[dict[str, Any]]
    data: Any
    answer: str
    confidence: float
    requires_human_approval: bool
    outcome: str


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
    ) -> None:
        self.tools = tools or ToolRegistry()
        self.router = router or ModelRouter()
        self.llm = llm or LlmClient()
        self.metrics = metrics or CopilotMetrics()
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
        state: AgentState = {
            "message": request.message,
            "context": request.context,
            "security": security,
            "idempotency_key": request.idempotency_key,
            "confirm_high_risk": request.confirm_high_risk,
            "tool_calls": [],
        }
        if request.action is not None:
            state["action"] = request.action

        if self.graph is not None:
            final = await self.graph.ainvoke(state)
        else:
            for step in (self._classify, self._plan, self._act, self._finalize):
                state = await step(state)  # type: ignore[assignment]
            final = state

        return CopilotResponse(
            answer=final["answer"],
            action=final["action"],
            confidence=final["confidence"],
            requires_human_approval=final.get("requires_human_approval", False),
            tool_calls=[ToolCall(**call) for call in final.get("tool_calls", [])],
            data=final.get("data"),
            model=final.get("route", {}).get("model"),
            model_tier=final.get("route", {}).get("tier"),
            prompt_version=PROMPT_VERSION,
            correlation_id=security.correlation_id,
            idempotency_key=request.idempotency_key,
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
        try:
            sanitized = sanitize_input(state["message"])
            state["message"] = sanitized.text
            if sanitized.sanitized:
                self.metrics.increment("copilot.guardrail.input_sanitized")
        except GuardrailViolation as ex:
            state["answer"] = str(ex)
            state["confidence"] = 0.0
            state["requires_human_approval"] = False
            state["action"] = state.get("action", CopilotAction.CHAT)
            self.metrics.increment("copilot.guardrail.input_blocked")
            return state

        action = state.get("action", CopilotAction.CHAT)
        decision = self.router.route(state["message"], action)
        state["route"] = {
            "tier": decision.tier.value,
            "model": decision.model,
            "complexity": decision.complexity,
            "reason": decision.reason,
        }
        state["prompt"] = prompt_for_action(action.value)
        self.metrics.increment(f"copilot.route.{decision.tier.value}")
        return state

    async def _act(self, state: AgentState) -> AgentState:
        if state.get("answer"):
            return state
        action = state.get("action", CopilotAction.CHAT)
        try:
            if action == CopilotAction.START_WORKFLOW:
                return await self._start_workflow(state)
            if action == CopilotAction.DISCOVER_WORKFLOW:
                return await self._discover_workflow(state)
            if action == CopilotAction.QUERY_TASKS:
                return await self._query_tasks(state)
            if action == CopilotAction.COMPLETE_TASK:
                return await self._complete_task(state)
            if action == CopilotAction.APPROVAL_ASSISTANCE:
                return await self._approval_assistance(state)
            if action == CopilotAction.KNOWLEDGE_SEARCH:
                return await self._knowledge_search(state)
            return await self._chat(state)
        except GuardrailViolation as ex:
            state["answer"] = str(ex)
            state["confidence"] = 0.0
            state["requires_human_approval"] = False
            self.metrics.increment("copilot.guardrail.action_blocked")
            return state

    async def _finalize(self, state: AgentState) -> AgentState:
        answer = state.get("answer") or "I could not complete that request."
        action = state.get("action", CopilotAction.CHAT)
        try:
            answer = sanitize_output(answer)
        except GuardrailViolation as ex:
            answer = f"The response was blocked by safety guardrails: {ex}"
            state["requires_human_approval"] = True
            self.metrics.increment("copilot.guardrail.output_blocked")
        state["answer"] = answer
        state["confidence"] = state.get("confidence", estimate_confidence(answer, action.value))
        if state["confidence"] < self.confidence_threshold:
            state["requires_human_approval"] = True
            self.metrics.increment("copilot.hitl.low_confidence")

        security = state["security"]
        outcome = state.get("outcome") or (
            "HITL" if state.get("requires_human_approval") else "SUCCESS"
        )
        audit_payload = {
            "action": action.value,
            "confidence": round(state["confidence"], 4),
            "requiresHumanApproval": state.get("requires_human_approval", False),
            "model": state.get("route", {}).get("model"),
            "modelTier": state.get("route", {}).get("tier"),
            "promptVersion": PROMPT_VERSION,
            "tools": [call["name"] for call in state.get("tool_calls", [])],
            "outcome": outcome,
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
            return self._record(
                state,
                ToolCall(name="complete_task", ok=False, error="taskId is required"),
                "Tell me which task to complete, or open it from the task list first.",
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
        return self._record(state, call, answer, data=call.result)

    async def _approval_assistance(self, state: AgentState) -> AgentState:
        context = state.get("context", {})
        workflow_instance_id = context.get("workflowInstanceId")
        if not workflow_instance_id:
            return self._record(
                state,
                ToolCall(name="create_approval", ok=False, error="workflowInstanceId is required"),
                "Open a workflow instance first so I can prepare an approval task.",
            )
        if not state.get("confirm_high_risk"):
            state["requires_human_approval"] = True
            state["confidence"] = 0.8
            state["data"] = {"workflowInstanceId": workflow_instance_id}
            state["answer"] = (
                "I can create an approval task for this instance. Confirm the title and assignee."
            )
            return state
        call = await self.tools.invoke(
            "create_approval",
            {
                "workflowInstanceId": workflow_instance_id,
                "title": context.get("title", "Copilot approval request"),
                "description": context.get("description", state["message"]),
                "assigneeId": context.get("assigneeId"),
                "idempotencyKey": state.get("idempotency_key"),
            },
            state["security"],
            state.get("idempotency_key"),
        )
        answer = (
            "The approval task was created."
            if call.ok
            else f"The approval task could not be created: {call.error}"
        )
        return self._record(state, call, answer, data=call.result)

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

        hits = call.result
        assessment = assess_hits(
            hits,
            state["message"],
            min_score=self.knowledge_min_score,
            min_hits=self.knowledge_min_hits,
            threshold=self.confidence_threshold,
        )
        self.metrics.increment(f"copilot.knowledge.{assessment.outcome.lower()}")

        if assessment.outcome == NO_ANSWER:
            answer = (
                "I don't know. I could not find a tenant document that answers this question, "
                "so I will not guess."
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
            return self._record(
                state,
                call,
                answer,
                data=hits,
                confidence=assessment.confidence,
                outcome=LOW_CONFIDENCE,
                requires_human_approval=True,
            )

        lines = []
        for hit in hits[:5]:
            if isinstance(hit, dict):
                title = hit.get("title") or hit.get("fileId", "document")
                snippet = (hit.get("snippet") or "")[:300]
                lines.append(f"- {title}: {snippet}")
        return self._record(
            state,
            call,
            "Relevant tenant documents:\n" + "\n".join(lines),
            data=hits,
            confidence=assessment.confidence,
            outcome=SUCCESS,
            requires_human_approval=False,
        )

    async def _chat(self, state: AgentState) -> AgentState:
        user = await self.tools.invoke("get_user", {}, state["security"])
        state.setdefault("tool_calls", []).append(user.model_dump())
        route = state.get("route", {})
        llm_answer = await self.llm.complete(
            state.get("prompt", ""), state["message"], route.get("model", "local-heuristic")
        )
        if llm_answer:
            return self._record(
                state,
                ToolCall(name="llm", ok=True),
                llm_answer,
            )
        name = ""
        if isinstance(user.result, dict):
            name = user.result.get("fullName") or user.result.get("email") or ""
        greeting = f"Hello {name}. " if name else ""
        return self._record(
            state,
            ToolCall(name="llm", ok=True),
            greeting
            + "I can discover and start workflows, query and complete your tasks, assist with "
            "approvals and search tenant documents. What would you like to do?",
        )

    # ------------------------------------------------------------------ helpers
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


def format_tool_payload(payload: Any) -> str:
    """Stable JSON rendering used in structured logs."""
    return json.dumps(payload, default=str, sort_keys=True)

"""Policy-based dynamic model routing (C4/C9)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum

from app.copilot.models import CopilotAction


class ModelTier(StrEnum):
    CHEAP = "cheap"
    STANDARD = "standard"
    COMPLEX = "complex"


@dataclass(frozen=True)
class RouteDecision:
    tier: ModelTier
    model: str
    complexity: float
    reason: str


class ModelRouter:
    """Routes simple requests to cheap models and multi-step requests to larger models.

    The router is deliberately deterministic so a tenant's routing decisions are explainable and
    testable. Model names are configuration, never hard-coded provider assumptions.
    """

    def __init__(
        self,
        cheap_model: str | None = None,
        standard_model: str | None = None,
        complex_model: str | None = None,
    ) -> None:
        self.cheap_model = cheap_model or os.getenv("AI_MODEL_CHEAP", "local-heuristic")
        self.standard_model = standard_model or os.getenv("AI_MODEL_STANDARD", "gpt-4o-mini")
        self.complex_model = complex_model or os.getenv("AI_MODEL_COMPLEX", "gpt-4o")

    def complexity(self, message: str, action: CopilotAction) -> float:
        lowered = message.lower()
        score = min(len(message) / 1_000, 0.4)
        if action in {
            CopilotAction.START_WORKFLOW,
            CopilotAction.COMPLETE_TASK,
            CopilotAction.ASSIGN_TASK,
            CopilotAction.SEND_NOTIFICATION,
            CopilotAction.APPROVAL_ASSISTANCE,
        }:
            score += 0.35
        if any(word in lowered for word in ("and", "then", "after", "multiple", "compare", "plan")):
            score += 0.15
        if any(word in lowered for word in ("step", "workflow", "approval", "document", "search")):
            score += 0.1
        return max(0.0, min(1.0, score))

    def route(
        self,
        message: str,
        action: CopilotAction,
        latency_budget_ms: int = 10_000,
    ) -> RouteDecision:
        score = self.complexity(message, action)
        if score >= 0.65:
            tier = ModelTier.COMPLEX
            model = self.complex_model
            reason = "multi-step or high-risk action"
        elif score >= 0.3:
            tier = ModelTier.STANDARD
            model = self.standard_model
            reason = "moderate complexity"
        else:
            tier = ModelTier.CHEAP
            model = self.cheap_model
            reason = "short low-risk request"
        if latency_budget_ms < 2_000 and tier == ModelTier.COMPLEX:
            tier = ModelTier.STANDARD
            model = self.standard_model
            reason = "latency budget downgraded the model"
        return RouteDecision(tier=tier, model=model, complexity=score, reason=reason)

"""Policy-based, budget-aware dynamic model routing (C4/C9, issue #300).

Routing is deterministic and explainable: complexity, action risk, the tenant's remaining token
budget, the estimated token cost and the latency budget all participate in a versioned policy table.
The decision carries the tier, model, cost estimate and a human-readable reason; the agent exposes
the reason in the response and the audit row.

Budget inputs are server-derived. They arrive on the backend-to-AI-layer security context, never
from the SPA request body; a client-supplied budget field is ignored.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum

from app.copilot.models import CopilotAction

ROUTING_POLICY_VERSION = "v1"


class ModelTier(StrEnum):
    CHEAP = "cheap"
    STANDARD = "standard"
    COMPLEX = "complex"


@dataclass(frozen=True)
class ModelOption:
    tier: ModelTier
    model: str
    cost_micros_per_token: int
    typical_latency_ms: int


@dataclass(frozen=True)
class RouteDecision:
    tier: ModelTier
    model: str
    complexity: float
    reason: str
    policy: str = ROUTING_POLICY_VERSION
    estimated_cost_micros: int = 0
    downgraded: bool = False
    remaining_budget_tokens: int | None = None
    latency_budget_ms: int = 10_000

    def as_audit(self) -> dict[str, object]:
        return {
            "routingPolicy": self.policy,
            "routingReason": self.reason,
            "model": self.model,
            "modelTier": self.tier.value,
            "complexity": round(self.complexity, 4),
            "estimatedCostMicros": self.estimated_cost_micros,
            "routingDowngraded": self.downgraded,
            "remainingBudgetTokens": self.remaining_budget_tokens,
            "latencyBudgetMs": self.latency_budget_ms,
        }


class ModelRouter:
    """Routes simple requests to cheap models and multi-step requests to larger models.

    The policy table is deliberately small and explicit so every boundary is testable:

    ============================  ================================================
    Condition                     Result
    ============================  ================================================
    complexity >= 0.65            complex tier
    0.30 <= complexity < 0.65     standard tier
    complexity < 0.30             cheap tier
    high-risk action              at least standard while budget is healthy
    latency < 2 000 ms            complex -> standard
    latency < 500 ms              standard -> cheap
    remaining budget == 0         cheapest tier
    remaining < cost * 5          downgrade one tier (high-risk floors at standard)
    ============================  ================================================
    """

    def __init__(
        self,
        cheap_model: str | None = None,
        standard_model: str | None = None,
        complex_model: str | None = None,
        *,
        cheap_cost_micros_per_token: int | None = None,
        standard_cost_micros_per_token: int | None = None,
        complex_cost_micros_per_token: int | None = None,
        latency_downgrade_ms: int | None = None,
        latency_cheap_ms: int | None = None,
        budget_reserve_multiplier: int | None = None,
        default_latency_budget_ms: int | None = None,
    ) -> None:
        self.catalog: dict[ModelTier, ModelOption] = {
            ModelTier.CHEAP: ModelOption(
                ModelTier.CHEAP,
                cheap_model or os.getenv("AI_MODEL_CHEAP", "local-heuristic"),
                cheap_cost_micros_per_token
                if cheap_cost_micros_per_token is not None
                else int(os.getenv("AI_MODEL_CHEAP_COST_MICROS_PER_TOKEN", "1")),
                500,
            ),
            ModelTier.STANDARD: ModelOption(
                ModelTier.STANDARD,
                standard_model or os.getenv("AI_MODEL_STANDARD", "gpt-4o-mini"),
                standard_cost_micros_per_token
                if standard_cost_micros_per_token is not None
                else int(os.getenv("AI_MODEL_STANDARD_COST_MICROS_PER_TOKEN", "2")),
                1_500,
            ),
            ModelTier.COMPLEX: ModelOption(
                ModelTier.COMPLEX,
                complex_model or os.getenv("AI_MODEL_COMPLEX", "gpt-4o"),
                complex_cost_micros_per_token
                if complex_cost_micros_per_token is not None
                else int(os.getenv("AI_MODEL_COMPLEX_COST_MICROS_PER_TOKEN", "10")),
                4_000,
            ),
        }
        self.cheap_model = self.catalog[ModelTier.CHEAP].model
        self.standard_model = self.catalog[ModelTier.STANDARD].model
        self.complex_model = self.catalog[ModelTier.COMPLEX].model
        self.complex_threshold = float(os.getenv("AI_ROUTING_COMPLEX_THRESHOLD", "0.65"))
        self.standard_threshold = float(os.getenv("AI_ROUTING_STANDARD_THRESHOLD", "0.3"))
        self.latency_downgrade_ms = (
            latency_downgrade_ms
            if latency_downgrade_ms is not None
            else int(os.getenv("AI_ROUTING_LATENCY_DOWNGRADE_MS", "2000"))
        )
        self.latency_cheap_ms = (
            latency_cheap_ms
            if latency_cheap_ms is not None
            else int(os.getenv("AI_ROUTING_LATENCY_CHEAP_MS", "500"))
        )
        self.budget_reserve_multiplier = (
            budget_reserve_multiplier
            if budget_reserve_multiplier is not None
            else int(os.getenv("AI_ROUTING_BUDGET_RESERVE_MULTIPLIER", "5"))
        )
        self.default_latency_budget_ms = (
            default_latency_budget_ms
            if default_latency_budget_ms is not None
            else int(os.getenv("AI_ROUTING_DEFAULT_LATENCY_BUDGET_MS", "10000"))
        )
        self.high_risk_actions = {
            CopilotAction.START_WORKFLOW,
            CopilotAction.COMPLETE_TASK,
            CopilotAction.ASSIGN_TASK,
            CopilotAction.SEND_NOTIFICATION,
            CopilotAction.APPROVAL_ASSISTANCE,
        }

    def complexity(self, message: str, action: CopilotAction) -> float:
        lowered = message.lower()
        score = min(len(message) / 1_000, 0.4)
        if action in self.high_risk_actions:
            score += 0.35
        if any(word in lowered for word in ("and", "then", "after", "multiple", "compare", "plan")):
            score += 0.15
        if any(word in lowered for word in ("step", "workflow", "approval", "document", "search")):
            score += 0.1
        # Round to the policy precision so an exact 0.65 boundary is not lost to binary floating
        # point (0.3 + 0.35 evaluates to 0.6499999999999999).
        return round(max(0.0, min(1.0, score)), 3)

    def route(
        self,
        message: str,
        action: CopilotAction,
        latency_budget_ms: int = 10_000,
        remaining_budget_tokens: int | None = None,
        estimated_token_cost: int | None = None,
        risk: str | None = None,
    ) -> RouteDecision:
        try:
            return self._decide(
                message,
                action,
                latency_budget_ms,
                remaining_budget_tokens,
                estimated_token_cost,
                risk,
            )
        except Exception:
            # A broken policy must never route to a more expensive model than the safe floor.
            cheap = self.catalog[ModelTier.CHEAP]
            estimated = max(1, estimated_token_cost or self.estimate_tokens(message))
            return RouteDecision(
                tier=ModelTier.CHEAP,
                model=cheap.model,
                complexity=0.0,
                reason="routing policy failure; using the cheapest safe tier",
                policy=ROUTING_POLICY_VERSION,
                estimated_cost_micros=estimated * cheap.cost_micros_per_token,
                downgraded=True,
                remaining_budget_tokens=remaining_budget_tokens,
                latency_budget_ms=latency_budget_ms,
            )

    def _decide(
        self,
        message: str,
        action: CopilotAction,
        latency_budget_ms: int,
        remaining_budget_tokens: int | None,
        estimated_token_cost: int | None,
        risk: str | None,
    ) -> RouteDecision:
        latency = (
            latency_budget_ms
            if isinstance(latency_budget_ms, int) and latency_budget_ms >= 0
            else self.default_latency_budget_ms
        )
        estimated = (
            estimated_token_cost
            if isinstance(estimated_token_cost, int) and estimated_token_cost > 0
            else self.estimate_tokens(message)
        )
        score = self.complexity(message, action)
        high_risk = risk == "high" or action in self.high_risk_actions
        downgraded = False
        if score >= self.complex_threshold:
            tier = ModelTier.COMPLEX
            reason = "multi-step or high-risk action"
        elif score >= self.standard_threshold:
            tier = ModelTier.STANDARD
            reason = "moderate complexity"
        else:
            tier = ModelTier.CHEAP
            reason = "short low-risk request"

        if high_risk and tier == ModelTier.CHEAP:
            tier = ModelTier.STANDARD
            reason = "high-risk action requires at least the standard tier"
            downgraded = True

        if latency < self.latency_downgrade_ms and tier == ModelTier.COMPLEX:
            tier = ModelTier.STANDARD
            reason = "latency budget downgraded the model"
            downgraded = True
        elif latency < self.latency_cheap_ms and tier == ModelTier.STANDARD:
            tier = ModelTier.CHEAP
            reason = "tight latency budget downgraded the model to the cheap tier"
            downgraded = True

        if remaining_budget_tokens is not None:
            remaining = max(0, int(remaining_budget_tokens))
            if remaining == 0:
                if tier != ModelTier.CHEAP:
                    downgraded = True
                tier = ModelTier.CHEAP
                reason = "tenant AI budget is exhausted; using the cheapest tier"
            elif remaining < estimated * self.budget_reserve_multiplier:
                target = self._downgrade(tier, high_risk)
                if target != tier:
                    tier = target
                    reason = "low tenant AI budget downgraded the model"
                    downgraded = True
        option = self.catalog[tier]
        return RouteDecision(
            tier=tier,
            model=option.model,
            complexity=score,
            reason=reason,
            policy=ROUTING_POLICY_VERSION,
            estimated_cost_micros=estimated * option.cost_micros_per_token,
            downgraded=downgraded,
            remaining_budget_tokens=remaining_budget_tokens,
            latency_budget_ms=latency,
        )

    def _downgrade(self, tier: ModelTier, high_risk: bool) -> ModelTier:
        if tier == ModelTier.COMPLEX:
            return ModelTier.STANDARD
        if tier == ModelTier.STANDARD:
            # A high-risk action may use the cheap tier only when the budget is exhausted, not
            # merely low; this keeps one safety step for state-changing requests.
            return ModelTier.STANDARD if high_risk else ModelTier.CHEAP
        return ModelTier.CHEAP

    @staticmethod
    def estimate_tokens(message: str) -> int:
        """Conservative deterministic token estimate used when no meter is supplied."""
        return max(1, (len(message) + 3) // 4 + 128)

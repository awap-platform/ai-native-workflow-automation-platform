"""Dynamic model routing tests (C4/C9)."""

from __future__ import annotations

import asyncio
from itertools import product

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.models import CopilotAction, CopilotRequest, SecurityContext
from app.copilot.routing import ModelRouter, ModelTier
from app.copilot.tools import ToolRegistry


def test_short_request_routes_to_cheap_model() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    decision = router.route("hello", CopilotAction.CHAT)
    assert decision.tier == ModelTier.CHEAP
    assert decision.model == "cheap"


def test_multi_step_high_risk_request_routes_to_complex_model() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    decision = router.route(
        "start a workflow and then compare the approval steps for multiple documents",
        CopilotAction.START_WORKFLOW,
    )
    assert decision.tier == ModelTier.COMPLEX
    assert decision.model == "complex"


def test_latency_budget_downgrades_complex_model() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    decision = router.route(
        "start a workflow and then compare the approval steps for multiple documents",
        CopilotAction.START_WORKFLOW,
        latency_budget_ms=500,
    )
    assert decision.tier == ModelTier.STANDARD
    assert decision.reason == "latency budget downgraded the model"


def test_complexity_threshold_boundaries_are_exact() -> None:
    router = ModelRouter("cheap", "standard", "complex")

    assert router.route("a" * 299, CopilotAction.CHAT).tier == ModelTier.CHEAP
    assert router.route("a" * 300, CopilotAction.CHAT).tier == ModelTier.STANDARD
    assert router.route("a" * 649, CopilotAction.CHAT).tier == ModelTier.STANDARD
    # Length alone caps at 0.4 complexity; a high-risk action adds the 0.35 that reaches 0.65.
    assert router.route("a" * 300, CopilotAction.START_WORKFLOW).tier == ModelTier.COMPLEX


def test_high_risk_action_never_routes_below_standard_with_a_healthy_budget() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    decision = router.route("start", CopilotAction.START_WORKFLOW)

    assert decision.tier == ModelTier.STANDARD
    assert decision.reason == "moderate complexity"


def test_low_budget_downgrades_complex_to_standard() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    decision = router.route(
        "a" * 300,
        CopilotAction.START_WORKFLOW,
        remaining_budget_tokens=499,
        estimated_token_cost=100,
    )

    assert decision.tier == ModelTier.STANDARD
    assert decision.reason == "low tenant AI budget downgraded the model"
    assert decision.downgraded is True


def test_budget_exactly_at_the_reserve_boundary_does_not_downgrade() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    decision = router.route(
        "a" * 300,
        CopilotAction.START_WORKFLOW,
        remaining_budget_tokens=500,
        estimated_token_cost=100,
    )

    assert decision.tier == ModelTier.COMPLEX
    assert decision.downgraded is False


def test_exhausted_budget_uses_the_cheap_tier_even_for_high_risk() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    decision = router.route(
        "a" * 300,
        CopilotAction.START_WORKFLOW,
        remaining_budget_tokens=0,
        estimated_token_cost=100,
    )

    assert decision.tier == ModelTier.CHEAP
    assert decision.reason == "tenant AI budget is exhausted; using the cheapest tier"


def test_negative_budget_is_treated_as_exhausted() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    decision = router.route("a" * 300, CopilotAction.START_WORKFLOW, remaining_budget_tokens=-10)

    assert decision.tier == ModelTier.CHEAP


def test_latency_boundaries_are_exact() -> None:
    router = ModelRouter("cheap", "standard", "complex")

    assert (
        router.route("a" * 300, CopilotAction.START_WORKFLOW, latency_budget_ms=1_999).tier
        == ModelTier.STANDARD
    )
    assert (
        router.route("a" * 300, CopilotAction.START_WORKFLOW, latency_budget_ms=2_000).tier
        == ModelTier.COMPLEX
    )
    assert (
        router.route("a" * 300, CopilotAction.CHAT, latency_budget_ms=499).tier == ModelTier.CHEAP
    )
    assert (
        router.route("a" * 300, CopilotAction.CHAT, latency_budget_ms=500).tier
        == ModelTier.STANDARD
    )


def test_malformed_latency_and_unknown_action_use_safe_defaults() -> None:
    router = ModelRouter("cheap", "standard", "complex")

    malformed = router.route(
        "a" * 300,
        CopilotAction.START_WORKFLOW,
        latency_budget_ms="not-a-number",  # type: ignore[arg-type]
    )
    unknown = router.route("hello", None)  # type: ignore[arg-type]

    assert malformed.tier == ModelTier.COMPLEX
    assert malformed.latency_budget_ms == 10_000
    assert unknown.tier == ModelTier.CHEAP


def test_routing_policy_exception_falls_back_to_the_cheapest_tier(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    router = ModelRouter("cheap", "standard", "complex")

    def broken(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("policy table unavailable")

    monkeypatch.setattr(router, "_decide", broken)
    decision = router.route("a" * 650, CopilotAction.CHAT)

    assert decision.tier == ModelTier.CHEAP
    assert decision.downgraded is True
    assert "policy failure" in decision.reason


def test_costs_are_tier_specific_and_monotonic_under_budget_pressure() -> None:
    router = ModelRouter(
        "cheap",
        "standard",
        "complex",
        cheap_cost_micros_per_token=1,
        standard_cost_micros_per_token=2,
        complex_cost_micros_per_token=10,
    )
    healthy = router.route("a" * 300, CopilotAction.START_WORKFLOW, remaining_budget_tokens=100_000)
    low = router.route("a" * 300, CopilotAction.START_WORKFLOW, remaining_budget_tokens=10)
    exhausted = router.route("a" * 300, CopilotAction.START_WORKFLOW, remaining_budget_tokens=0)

    assert healthy.estimated_cost_micros > low.estimated_cost_micros
    assert low.estimated_cost_micros >= exhausted.estimated_cost_micros
    assert healthy.estimated_cost_micros == healthy.estimated_cost_micros


def test_every_policy_boundary_combination_keeps_the_contract() -> None:
    router = ModelRouter("cheap", "standard", "complex")
    messages = ("hello", "a" * 300, "a" * 650)
    actions = tuple(CopilotAction)
    latencies = (0, 499, 500, 1_999, 2_000, 10_000)
    budgets = (None, 0, 1, 499, 500, 100_000)
    risks = ("low", "high")

    for message, action, latency, budget, risk in product(
        messages, actions, latencies, budgets, risks
    ):
        decision = router.route(
            message,
            action,
            latency_budget_ms=latency,
            remaining_budget_tokens=budget,
            risk=risk,
        )
        assert decision.tier in ModelTier
        assert decision.model == router.catalog[decision.tier].model
        assert decision.policy == "v1"
        assert decision.reason
        assert decision.estimated_cost_micros >= 0
        if budget == 0:
            assert decision.tier == ModelTier.CHEAP


class RoutingFakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        self.calls.append((name, payload))
        if name == "find_workflow":
            return [{"id": "wf-1", "name": "Leave Request"}]
        if name == "create_workflow_instance":
            return {"id": "instance-1", "state": "STARTED"}
        return {"recorded": True}


def security(
    remaining_budget_tokens: int | None = None,
    latency_budget_ms: int | None = None,
    task_risk: str | None = None,
) -> SecurityContext:
    return SecurityContext(
        tenant_id="tenant-a",
        user_id="user-a",
        role="TENANT_ADMIN",
        remaining_budget_tokens=remaining_budget_tokens,
        latency_budget_ms=latency_budget_ms,
        task_risk=task_risk,
    )


def test_agent_passes_budget_and_latency_into_routing_and_audit() -> None:
    client = RoutingFakeClient()
    agent = CopilotAgent(
        tools=ToolRegistry(client),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
        confidence_threshold=0.7,
    )
    request = CopilotRequest(
        message="start a workflow and then compare the approval steps for multiple documents",
        action=CopilotAction.START_WORKFLOW,
        context={"workflowId": "wf-1"},
        confirm_high_risk=True,
    )

    exhausted = asyncio.run(
        agent.run(request, security(remaining_budget_tokens=0, latency_budget_ms=10_000))
    )
    tight = asyncio.run(
        agent.run(request, security(remaining_budget_tokens=100_000, latency_budget_ms=500))
    )

    assert exhausted.model_tier == "cheap"
    assert exhausted.routing_reason == "tenant AI budget is exhausted; using the cheapest tier"
    assert tight.model_tier == "standard"
    assert tight.routing_reason == "latency budget downgraded the model"
    audits = [payload for name, payload in client.calls if name == "audit_decision"]
    audit = audits[-1]
    assert audit["remainingBudgetTokens"] == 100_000
    assert audit["latencyBudgetMs"] == 500
    assert audit["routingPolicy"] == "v1"
    assert audit["estimatedCostMicros"] > 0


def test_client_supplied_budget_in_the_body_is_ignored() -> None:
    client = RoutingFakeClient()
    agent = CopilotAgent(
        tools=ToolRegistry(client),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
        confidence_threshold=0.7,
    )
    response = asyncio.run(
        agent.run(
            CopilotRequest(
                message="a" * 300,
                action=CopilotAction.START_WORKFLOW,
                context={"workflowId": "wf-1", "remainingBudgetTokens": 0, "latencyBudgetMs": 1},
                confirm_high_risk=True,
            ),
            security(remaining_budget_tokens=100_000, latency_budget_ms=10_000),
        )
    )

    assert response.model_tier == "complex"
    assert response.routing_reason == "multi-step or high-risk action"

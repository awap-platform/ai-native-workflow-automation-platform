"""Dynamic model routing tests (C4/C9)."""

from __future__ import annotations

from app.copilot.models import CopilotAction
from app.copilot.routing import ModelRouter, ModelTier


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

"""C5 split-brain invariant: a failed/corrupted LangGraph state cannot touch business state.

Issue #280. The agent graph may throw, time out, corrupt its own state or return an invalid shape;
in every case the recording backend proves that no workflow instance, node execution, outbox event
or task row changed. Business state is read back only from the backend contract, so a fresh agent
after a restart recovers from the Workflow Engine, never from LangGraph state.
"""

from __future__ import annotations

import asyncio

import pytest

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.models import CopilotRequest, SecurityContext
from app.copilot.tools import ToolRegistry
from tests.support.split_brain import FaultyAgent, RecordingBackend

TENANT = "00000000-0000-0000-0000-000000000001"


def security(tenant_id: str = TENANT) -> SecurityContext:
    return SecurityContext(
        tenant_id=tenant_id,
        user_id="00000000-0000-0000-0000-000000000002",
        role="TENANT_ADMIN",
        correlation_id="corr-split-brain",
    )


def confirmed_start(key: str = "key-1") -> CopilotRequest:
    return CopilotRequest(
        message="start leave request",
        confirm_high_risk=True,
        idempotency_key=key,
    )


def make_agent(backend: RecordingBackend, mode: str | None = None) -> CopilotAgent:
    tools = ToolRegistry(backend)  # type: ignore[arg-type]
    llm = LlmClient(base_url="", api_key="")
    if mode is None:
        return CopilotAgent(tools=tools, llm=llm, confidence_threshold=0.7)
    return FaultyAgent(mode=mode, tools=tools, llm=llm, confidence_threshold=0.7)


def test_normal_request_creates_exactly_one_consistent_instance() -> None:
    backend = RecordingBackend()
    response = asyncio.run(make_agent(backend).run(confirmed_start(), security()))

    assert response.data["id"] == "instance-1"
    assert backend.snapshot() == {
        "instances": 1,
        "node_executions": 1,
        "outbox_events": 1,
        "tasks": 0,
        "audit_rows": 1,
    }
    assert backend.tool_names() == [
        "find_workflow",
        "create_workflow_instance",
        "audit_decision",
    ]


def test_confirmed_start_records_the_idempotency_key_in_the_engine() -> None:
    backend = RecordingBackend()
    asyncio.run(make_agent(backend).run(confirmed_start("intent-42"), security()))

    assert backend.idempotency[(TENANT, "intent-42")] == "instance-1"
    assert backend.instances["instance-1"]["idempotencyKey"] == "intent-42"


@pytest.mark.parametrize(
    ("mode", "error"),
    [
        ("throw", RuntimeError),
        ("corrupt", RuntimeError),
        ("invalid_shape", AttributeError),
    ],
)
def test_broken_graph_never_touches_business_state(mode: str, error: type[BaseException]) -> None:
    backend = RecordingBackend()
    before = backend.snapshot()

    with pytest.raises(error):
        asyncio.run(make_agent(backend, mode).run(confirmed_start(), security()))

    assert backend.snapshot() == before
    assert backend.state_changing_calls() == []
    assert backend.calls == []


def test_corrupted_agent_state_is_not_used_as_business_state() -> None:
    backend = RecordingBackend()
    with pytest.raises(RuntimeError, match="corrupted"):
        asyncio.run(make_agent(backend, "corrupt").run(confirmed_start(), security()))
    # The corrupt graph wrote instances=99 into its own state; the engine still has none.
    assert backend.snapshot()["instances"] == 0
    assert backend.snapshot()["tasks"] == 0


def test_graph_timeout_leaves_business_state_unchanged() -> None:
    backend = RecordingBackend()
    before = backend.snapshot()
    agent = make_agent(backend, "timeout")

    async def scenario() -> None:
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(agent.run(confirmed_start(), security()), timeout=0.05)

    asyncio.run(scenario())
    assert backend.snapshot() == before
    assert backend.state_changing_calls() == []


def test_duplicate_concurrent_requests_with_one_key_create_one_instance() -> None:
    backend = RecordingBackend()
    first = make_agent(backend)
    second = make_agent(backend)
    request = confirmed_start("same-intent")

    async def scenario() -> list[object]:
        return await asyncio.gather(
            first.run(request, security()),
            second.run(request, security()),
        )

    responses = asyncio.run(scenario())
    assert len(backend.instances) == 1
    assert len(backend.idempotency) == 1
    assert responses[0].data["id"] == responses[1].data["id"] == "instance-1"
    assert backend.snapshot()["instances"] == 1


def test_two_different_keys_document_the_distinct_intent_policy() -> None:
    backend = RecordingBackend()
    agent = make_agent(backend)

    async def scenario() -> None:
        await asyncio.gather(
            agent.run(confirmed_start("intent-a"), security()),
            agent.run(confirmed_start("intent-b"), security()),
        )

    asyncio.run(scenario())
    assert len(backend.instances) == 2
    assert len(backend.idempotency) == 2


def test_agent_restart_recovers_business_state_from_the_engine() -> None:
    backend = RecordingBackend()
    first = asyncio.run(make_agent(backend).run(confirmed_start("restart-key"), security()))
    assert first.data["id"] == "instance-1"

    # A new process: fresh graph and empty LangGraph state, same engine/backend.
    restarted = make_agent(backend)
    recovered = asyncio.run(restarted.run(confirmed_start("restart-key"), security()))

    assert recovered.data["id"] == "instance-1"
    assert backend.snapshot()["instances"] == 1
    assert backend.snapshot()["node_executions"] == 1
    assert backend.snapshot()["outbox_events"] == 1


def test_rolled_back_tool_failure_creates_no_business_rows() -> None:
    backend = RecordingBackend()
    backend.fail_create_before_commit = True
    response = asyncio.run(make_agent(backend).run(confirmed_start(), security()))

    assert "could not be started" in response.answer.lower()
    assert backend.snapshot()["instances"] == 0
    assert backend.snapshot()["node_executions"] == 0
    assert backend.snapshot()["outbox_events"] == 0
    assert backend.snapshot()["audit_rows"] == 1


def test_commit_then_failure_is_recovered_by_the_same_key() -> None:
    backend = RecordingBackend()
    backend.fail_create_after_commit = True
    first = asyncio.run(make_agent(backend).run(confirmed_start("commit-key"), security()))
    assert "could not be started" in first.answer.lower()
    assert backend.snapshot()["instances"] == 1

    backend.fail_create_after_commit = False
    retried = asyncio.run(make_agent(backend).run(confirmed_start("commit-key"), security()))

    assert retried.data["id"] == "instance-1"
    assert backend.snapshot()["instances"] == 1
    assert backend.snapshot()["audit_rows"] == 2

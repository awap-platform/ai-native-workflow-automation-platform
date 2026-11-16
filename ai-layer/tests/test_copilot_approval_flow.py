"""Two-step HITL approval flow tests (issue #296).

These tests prove that the transport layer cannot create an approval task on its own: the first
request only proposes, the second must present the matching proposal id and payload hash, and any
mismatch, expiry, cross-tenant replay or duplicate confirmation leaves exactly the expected number
of approval tasks.
"""

from __future__ import annotations

import asyncio

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.models import CopilotAction, CopilotRequest, SecurityContext
from app.copilot.proposals import ApprovalProposalStore
from app.copilot.tools import ToolRegistry


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.keys: list[tuple[str, str | None]] = []

    async def call(self, name, payload, security, idempotency_key=None):  # type: ignore[no-untyped-def]
        self.calls.append((name, payload))
        self.keys.append((name, idempotency_key))
        if name == "create_approval":
            return {"id": "approval-1", "title": payload.get("title"), "status": "OPEN"}
        return {"recorded": True}

    def approval_calls(self) -> list[tuple[str, dict[str, object]]]:
        return [call for call in self.calls if call[0] == "create_approval"]

    def audit_payloads(self) -> list[dict[str, object]]:
        return [payload for name, payload in self.calls if name == "audit_decision"]


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def security(tenant: str = "tenant-a", user: str = "user-a") -> SecurityContext:
    return SecurityContext(
        tenant_id=tenant,
        user_id=user,
        role="TENANT_ADMIN",
        correlation_id="corr-approval",
    )


def build_agent(
    client: FakeClient, clock: Clock | None = None, ttl_seconds: float = 900.0
) -> CopilotAgent:
    return CopilotAgent(
        tools=ToolRegistry(client),  # type: ignore[arg-type]
        llm=LlmClient(base_url="", api_key=""),
        confidence_threshold=0.7,
        approval_proposals=ApprovalProposalStore(ttl_seconds=ttl_seconds, now=clock or Clock()),
    )


def proposal_request(
    context: dict[str, object] | None = None, confirm: bool = False
) -> CopilotRequest:
    return CopilotRequest(
        message="Create an approval for this leave request",
        action=CopilotAction.APPROVAL_ASSISTANCE,
        context={
            "workflowInstanceId": "instance-1",
            "title": "Approve leave",
            "description": "Ada requested three days of leave.",
            "assigneeId": "manager-1",
            **(context or {}),
        },
        confirm_high_risk=confirm,
    )


def test_first_call_only_proposes_and_creates_no_task() -> None:
    client = FakeClient()
    agent = build_agent(client)

    response = asyncio.run(agent.run(proposal_request(), security()))

    assert response.action == CopilotAction.APPROVAL_ASSISTANCE
    assert response.requires_human_approval is True
    assert client.approval_calls() == []
    assert response.data["proposalId"]
    assert len(response.data["proposalHash"]) == 64
    assert response.data["proposedAction"] == "create_approval"
    assert "nothing has been created" in response.answer.lower()


def test_confirmed_second_call_creates_exactly_one_task() -> None:
    client = FakeClient()
    agent = build_agent(client)
    first = asyncio.run(agent.run(proposal_request(), security()))

    second = asyncio.run(
        agent.run(
            proposal_request(
                {
                    "proposalId": first.data["proposalId"],
                    "proposalHash": first.data["proposalHash"],
                },
                confirm=True,
            ),
            security(),
        )
    )

    assert len(client.approval_calls()) == 1
    _, payload = client.approval_calls()[0]
    assert payload["workflowInstanceId"] == "instance-1"
    assert payload["title"] == "Approve leave"
    assert payload["idempotencyKey"] == first.data["proposalId"]
    assert second.requires_human_approval is False
    assert second.data["id"] == "approval-1"
    assert client.keys.count(("create_approval", first.data["proposalId"])) == 1


def test_audit_records_proposed_and_confirmed_decisions() -> None:
    client = FakeClient()
    agent = build_agent(client)
    first = asyncio.run(agent.run(proposal_request(), security()))
    asyncio.run(
        agent.run(
            proposal_request(
                {
                    "proposalId": first.data["proposalId"],
                    "proposalHash": first.data["proposalHash"],
                },
                confirm=True,
            ),
            security(),
        )
    )

    audits = client.audit_payloads()
    assert [audit["outcome"] for audit in audits] == ["PROPOSED", "CONFIRMED"]
    assert audits[0]["decision"] == "PROPOSED"
    assert audits[1]["decision"] == "CONFIRMED"
    assert audits[0]["proposalId"] == first.data["proposalId"]
    assert audits[0]["proposalHash"] == first.data["proposalHash"]


def test_confirmation_with_a_different_payload_is_rejected() -> None:
    client = FakeClient()
    agent = build_agent(client)
    first = asyncio.run(agent.run(proposal_request(), security()))

    changed = proposal_request(
        {
            "proposalId": first.data["proposalId"],
            "proposalHash": first.data["proposalHash"],
            "title": "Approve a different request",
        },
        confirm=True,
    )
    response = asyncio.run(agent.run(changed, security()))

    assert client.approval_calls() == []
    assert response.requires_human_approval is True
    assert response.data["errorCode"] == "PROPOSAL_PAYLOAD_MISMATCH"


def test_confirmation_without_a_proposal_is_rejected() -> None:
    client = FakeClient()
    response = asyncio.run(build_agent(client).run(proposal_request(confirm=True), security()))

    assert client.approval_calls() == []
    assert response.data["errorCode"] == "PROPOSAL_REQUIRED"
    assert response.requires_human_approval is True


def test_duplicate_confirmation_is_idempotent() -> None:
    client = FakeClient()
    agent = build_agent(client)
    first = asyncio.run(agent.run(proposal_request(), security()))
    confirmed = proposal_request(
        {
            "proposalId": first.data["proposalId"],
            "proposalHash": first.data["proposalHash"],
        },
        confirm=True,
    )
    asyncio.run(agent.run(confirmed, security()))
    replay = asyncio.run(agent.run(confirmed, security()))

    assert len(client.approval_calls()) == 1
    assert "already confirmed" in replay.answer.lower()
    assert replay.data["id"] == "approval-1"


def test_confirmation_after_expiry_is_rejected() -> None:
    client = FakeClient()
    clock = Clock()
    agent = build_agent(client, clock=clock, ttl_seconds=30)
    first = asyncio.run(agent.run(proposal_request(), security()))
    clock.advance(31)

    response = asyncio.run(
        agent.run(
            proposal_request(
                {
                    "proposalId": first.data["proposalId"],
                    "proposalHash": first.data["proposalHash"],
                },
                confirm=True,
            ),
            security(),
        )
    )

    assert client.approval_calls() == []
    assert response.data["errorCode"] == "PROPOSAL_UNKNOWN_OR_EXPIRED"


def test_another_tenant_cannot_confirm_the_proposal() -> None:
    client = FakeClient()
    agent = build_agent(client)
    first = asyncio.run(agent.run(proposal_request(), security()))

    response = asyncio.run(
        agent.run(
            proposal_request(
                {
                    "proposalId": first.data["proposalId"],
                    "proposalHash": first.data["proposalHash"],
                },
                confirm=True,
            ),
            security(tenant="tenant-b", user="user-b"),
        )
    )

    assert client.approval_calls() == []
    assert response.data["errorCode"] == "PROPOSAL_UNKNOWN_OR_EXPIRED"

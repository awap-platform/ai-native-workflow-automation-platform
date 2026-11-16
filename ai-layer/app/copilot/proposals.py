"""Server-side proposal registry for the two-step HITL confirmation flow (issue #296).

A high-risk action is never executed on the strength of a boolean in the request body alone. The
first request creates an opaque, tenant-scoped proposal that binds the exact payload to a SHA-256
hash and a short expiry. The second request must present the proposal id and hash; only then is the
domain tool invoked. Confirmations are idempotent: replaying a confirmed proposal returns the
original result without creating a second approval task.
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.copilot.models import SecurityContext

PROPOSED = "PROPOSED"
CONFIRMED = "CONFIRMED"


def payload_hash(payload: dict[str, Any]) -> str:
    """Return a stable SHA-256 hash of the proposal payload.

    Only JSON primitive values are accepted; the agent never puts callables, proxies or host objects
    into a proposal, so the hash always describes exactly what will be sent to the tool.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class ApprovalProposal:
    proposal_id: str
    tenant_id: str
    user_id: str
    proposal_hash: str
    payload: dict[str, Any]
    created_at: float
    expires_at: float
    idempotency_key: str | None = None
    status: str = PROPOSED
    result: Any = None
    audit: dict[str, Any] = field(default_factory=dict)

    def audit_record(self, decision: str) -> dict[str, Any]:
        record = {
            "proposalId": self.proposal_id,
            "proposalHash": self.proposal_hash,
            "decision": decision,
            "expiresAt": self.expires_at,
        }
        if self.idempotency_key:
            record["idempotencyKey"] = self.idempotency_key
        return record


class ApprovalProposalStore:
    """Bounded, tenant-scoped, expiring proposal store.

    The store is process-local, like the agent itself. Expiry and the bound payload hash are what
    prevent replay; the approval task remains durable in the backend once it has been created.
    """

    def __init__(
        self,
        ttl_seconds: float = 900.0,
        max_entries: int = 1_000,
        now: Callable[[], float] = time.time,
    ) -> None:
        self.ttl_seconds = max(1.0, ttl_seconds)
        self.max_entries = max(1, max_entries)
        self._now = now
        self._proposals: dict[str, ApprovalProposal] = {}

    def propose(
        self,
        security: SecurityContext,
        payload: dict[str, Any],
        idempotency_key: str | None = None,
    ) -> ApprovalProposal:
        self._purge_expired()
        if len(self._proposals) >= self.max_entries:
            oldest = min(self._proposals.values(), key=lambda item: item.created_at)
            self._proposals.pop(oldest.proposal_id, None)
        now = self._now()
        proposal = ApprovalProposal(
            proposal_id=uuid.uuid4().hex,
            tenant_id=security.tenant_id,
            user_id=security.user_id,
            proposal_hash=payload_hash(payload),
            payload=dict(payload),
            created_at=now,
            expires_at=now + self.ttl_seconds,
            idempotency_key=idempotency_key,
        )
        self._proposals[proposal.proposal_id] = proposal
        return proposal

    def get(self, proposal_id: str, tenant_id: str, user_id: str) -> ApprovalProposal | None:
        proposal = self._proposals.get(proposal_id)
        if proposal is None:
            return None
        # Another tenant (or another user) must not be able to confirm someone else's proposal.
        if proposal.tenant_id != tenant_id or proposal.user_id != user_id:
            return None
        if proposal.expires_at <= self._now():
            self._proposals.pop(proposal_id, None)
            return None
        return proposal

    def mark_confirmed(self, proposal: ApprovalProposal, result: Any) -> ApprovalProposal:
        proposal.status = CONFIRMED
        proposal.result = result
        return proposal

    def __len__(self) -> int:
        return len(self._proposals)

    def _purge_expired(self) -> None:
        now = self._now()
        expired = [key for key, item in self._proposals.items() if item.expires_at <= now]
        for key in expired:
            self._proposals.pop(key, None)

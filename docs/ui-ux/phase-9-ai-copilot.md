# Phase 9 — AI Copilot experience

This phase turns the Copilot API into a usable, auditable assistant surface at `/copilot`. It adds
conversation history and sessions, suggestion cards, progressive answer reveal with cancel, tool-call
cards with redacted arguments, a hash-bound HITL approval panel, citations, explicit no-answer and
low-confidence states, an audit view, budget usage and every documented unhappy path.

## Contract additions

The AI layer extends `CopilotResponse` with SPA metadata while remaining backward compatible:

| Field | Meaning |
|---|---|
| `outcome` | `SUCCESS`, `NO_ANSWER`, `LOW_CONFIDENCE`, `GUARDRAIL_BLOCKED`, `PROPOSED`, `CONFIRMED`, … |
| `citations[]` | Structured tenant sources: index, title, document id, chunk index, score. |
| `budget` | Server-derived remaining/monthly/used tokens and estimated cost. |
| `warnings[]` | Injection/PII/guardrail notices with a machine code and severity. |
| `guardrail` | Winning policy, decision, score, version and fail-closed flag. |
| `audit` | Per-request record keyed by the idempotency key (or correlation id) with tools and decision. |

The gRPC contract is intentionally unchanged: the gRPC adapter projects the REST envelope onto the
proto fields, so adding SPA-only metadata cannot break the typed transport.

## Sessions and history

Conversation history is stored in the browser under
`awap.copilot.sessions.v1:<tenant>:<user>`. The workspace is remounted with the active tenant as its
React key, so one tenant's history cannot render under another tenant even for a frame. The AI layer
is stateless; there is no server-side conversation store in this phase (honest limitation).

## Streaming and cancel

The answer is revealed progressively from the completed response with an immediate first chunk and a
cancel button. The first-token measurement is the transport response time, asserted under two seconds
against a deterministic stub. This is presentation-layer streaming, not provider token streaming: the
backend proxy in this phase is request/response, so a true SSE/WebSocket transport is a documented
follow-up.

## Tool calls

Every tool call renders its name, `ok`/`failed` status and arguments. Sensitive keys (passwords,
tokens, API keys, card/IBAN/email/phone/SSN) are replaced with `[REDACTED]`; PII inside ordinary
values is replaced with `[PII_REDACTED]`. A failed tool remains visible while the answer continues.

## HITL approval

The approval panel shows the proposed action, workflow instance, title/description, the payload hash
and the idempotency key before approval. Approving sends the second request with `confirm: true`, the
same proposal id/hash and the **same idempotency key**. Rejecting sends no action at all; the page
only records a local rejection turn. No-answer and low-confidence states require human review and
link to the task inbox; they do not auto-create a task.

## Citations and groundedness

Knowledge answers render citation cards with document id, chunk index and score. A successful
knowledge answer with no citation is flagged instead of being presented as a grounded fact. Citation
coverage is limited to `knowledge_search`; workflow, task and notification answers cite their tool
calls rather than documents.

## Audit view and budget

The audit view renders one deduplicated entry per logical request (idempotency key or correlation
id), including tool status, outcome, prompt/model, proposal hash and decision. Replaying the same
request key does not add a second entry. The budget indicator shows the remaining token budget, or
explicitly says the deployment did not report one.

## Error handling

| Path | Behaviour |
|---|---|
| LLM timeout | One automatic retry with the same idempotency key. |
| Budget 429 | Remaining tokens are rendered; retry is not offered until the budget is raised. |
| Rate-limit 429 | Retry after the server's `Retry-After`. |
| Tool 500 | Tool card shows `failed`; the answer continues. |
| Empty answer | Treated as `NO_ANSWER` with a human-review path. |
| Network drop | Offline banner, reconnect, retry keeps the request key. |
| Long message | 8,000-character limit enforced before any model/tool call. |
| Harmful content / injection | Guardrail warning, no tool call and a human-review state. |
| Duplicate idempotency | One action and one audit entry. |
| Session expiry | The API layer redirects to sign-in; the UI explains the session expired. |
| Mobile | The layout stacks at phone width and remains keyboard/a11y usable. |

## Evidence

- `frontend/lib/__tests__/copilot.test.ts` — redaction, audit dedupe, citations, no-answer,
  budget and error classification.
- `frontend/lib/hooks/__tests__/useCopilot.test.tsx` — T9-03/T9-04 idempotent approval/reject,
  timeout retry, first token, tenant isolation and cancel.
- `frontend/app/(app)/copilot/__tests__/page.test.tsx` — T9-01/T9-02/T9-05/T9-06/T9-07 surfaces,
  HITL panel, budget 429, long-message limit and mobile-friendly controls.
- `frontend/e2e/phase-9-ai-copilot.spec.ts` — T9-01…T9-11 and U9-01/U9-02/U9-07/U9-10 with axe and
  visual baselines.
- `ai-layer/tests/test_copilot_phase9.py` — response metadata, citations, warnings and budget 429.

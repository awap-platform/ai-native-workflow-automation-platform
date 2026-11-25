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
- Full Phase 2 journey (issue 284) — [`copilot-journey.spec.ts`](../../frontend/e2e/copilot-journey.spec.ts)
  runs the deterministic natural-language → AI_TASK HITL → approval → completion path, and
  [`copilot-live-provider.spec.ts`](../../frontend/e2e/copilot-live-provider.spec.ts) runs nightly
  against a configured provider via [`.github/workflows/copilot-nightly.yml`](../../.github/workflows/copilot-nightly.yml).
  See [`copilot-full-journey.md`](copilot-full-journey.md).

## Server-persisted conversations (issue #373)

The Copilot screen used to keep its threads in React state seeded from `localStorage`, so a reload,
a second device or a crashed tab erased the history and could strand a pending HITL approval. The
thread now lives on the server and the browser cache is only a draft buffer.

| Concern | Decision |
| --- | --- |
| Storage | `copilot_sessions`, `copilot_turns`, `copilot_hitl` with a tenant foreign key and RLS |
| Turns | Append-only, `sequence` unique per session, `content_hash` chained to `previous_hash` |
| Honesty | `Idempotency-Key` per turn makes a retried send return the stored turn, not a duplicate |
| HITL | Persisted with `PENDING`; the decision is recorded once and a replay answers 409 |
| Secrets | `CopilotRedaction` masks bearer tokens, API keys, AWS ids and `password:`/`secret:` pairs before write |
| Retention | Sessions expire after 30 days; `CopilotRetentionJob` deletes them (row, turns, approvals) once |
| Export | `GET /sessions/{id}/export` returns every turn and publishes `COPILOT_SESSION_EXPORTED` |
| Hydration | The client lists sessions, hydrates the five newest threads and merges by turn id |

- Offline starts are supported: when the list call fails, the screen keeps the cached threads and
  shows the existing offline banner instead of a blank page. A queued turn is pushed as soon as the
  next successful load records the session on the server.
- A deleted or foreign session answers 404 and the UI shows the cached copy read-only; a corrupt
  stored turn is skipped with a warning so the rest of the thread still loads.
- Counters: `awap.copilot.session.created`, `awap.copilot.turn.appended`,
  `awap.copilot.hitl.decided`, `awap.copilot.session.purged`.

Limitations: content is redacted, not encrypted with a per-tenant key; encryption at rest is the
database's responsibility in this deployment, and the retention window is global rather than per
tenant.

## Provider streaming (issue #374)

The Copilot used to reveal an already-complete answer with an interval loop, so `firstTokenMs` measured
an animation tick and cancellation could not stop generation. The answer is now streamed.

- **Contract:** `POST /api/v1/copilot/chat/stream` returns `text/event-stream` frames that are single
  `data:` JSON objects with `v` (schema version, currently `1`), `type`, `seq` and a payload. Types are
  `token` (`delta`), `tool` (`call`), `citation` (`citation`), `usage` (`model`, `budget`), `done`
  (`response`) and `error` (`message`). A client that only understands buffered JSON can ignore every
  frame except `done`, whose payload is identical to `POST /chat`, so streamed and buffered answers
  keep parity and the audit trail is the same.
- **Proxy:** the backend relays the upstream body with `StreamingResponseBody`, flushes each frame and
  sends `Cache-Control: no-cache` plus `X-Accel-Buffering: no` so no proxy buffers the stream. A client
  disconnect closes the upstream stream, which aborts the provider request instead of billing an unread
  answer.
- **Client:** `readCopilotStream` parses frames incrementally, drops a malformed frame instead of
  failing the answer, ignores an out-of-order `seq`, and calls `onFirstDelta` exactly once — that is
  where the real time-to-first-token is recorded. Deltas are rendered as text nodes, never HTML.
- **Fallback:** if the stream cannot be opened (older AI layer, disabled feature, proxy rewriting), the
  hook falls back to the buffered `/chat` call, so the screen keeps working with identical output.

Limitations: the local heuristic provider has no token API, so its deltas are deterministic
fragments of the finished answer; the frame contract, ordering, cancellation and TTFT measurement are
the same either way, and a provider that streams natively only has to emit the same frames.

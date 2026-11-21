# AI Copilot and agentic workflow automation (Phase 2)

This document describes the implemented AI-native Phase 2 slice: a FastAPI/LangGraph Copilot,
permission-checked tool execution, HITL safeguards, dynamic model routing, versioned prompts and
tenant-scoped knowledge search.

## Architecture boundary

- **LangGraph owns only agent-internal planning state.** Business process state remains exclusively
  in the Java Workflow Engine. The Copilot can change business state only through audited tools.
- The SPA calls the backend at `/api/v1/copilot/*`; the backend forwards the authenticated tenant,
  user and role context to the AI layer.
- The AI layer calls the backend at `/internal/tools/*` with a shared service credential. The
  backend re-verifies the caller's role and permission on every tool call.
- Tool calls always run inside the tenant context, so PostgreSQL RLS and the JPA tenant filter apply.

### Enforced state-ownership invariant (issue #280)

The split-brain boundary is proven by an automated test, not only documented.
`ai-layer/tests/test_copilot_split_brain.py` injects a LangGraph node that throws, times out,
corrupts its own state or returns an invalid shape, and runs it against
`ai-layer/tests/support/split_brain.py`, a recording backend that implements the real tool contract.
The test asserts that workflow instance, node execution, outbox event and task rows are unchanged
after every agent failure, that duplicate concurrent requests with one idempotency key create exactly
one instance, and that a freshly restarted agent recovers business state only from the Workflow
Engine — never from LangGraph state. Any regression that reads business state out of the agent graph
fails this suite.

## Capability status

Status legend: **Implemented** means code plus an automated test; **Partial** means implemented with a
documented limitation; **Planned** means not implemented yet.
[`scripts/check-capability-matrix.mjs`](../scripts/check-capability-matrix.mjs) fails CI when an
Implemented row has no test link or a Partial/Planned row has no issue link.

| ID | Capability | Status | Evidence | Issue |
|---|---|---|---|---|
| COP-STATE | LangGraph owns only planning state; business state stays in the engine | Implemented | [`test_copilot_split_brain.py`](../ai-layer/tests/test_copilot_split_brain.py) | #280 |
| COP-TOOLS | Permission-checked internal tools scoped to the authenticated tenant | Implemented | [`InternalAiToolControllerTest.java`](../backend/identity/src/test/java/com/awap/ai/interfaces/api/InternalAiToolControllerTest.java) | #305 |
| COP-AUTH | Forged permission headers ignored; permissions re-derived from the verified role | Implemented | [`InternalAiToolAuthTest.java`](../backend/identity/src/test/java/com/awap/ai/application/InternalAiToolAuthTest.java) | #305 |
| COP-DISCOVERY | `find_workflow` and `create_workflow_instance` with idempotent replay | Implemented | [`test_copilot_agent.py`](../ai-layer/tests/test_copilot_agent.py) | #283 |
| COP-TASKS | `query_tasks` and the confirmed `complete_task` approve/reject/complete flow | Implemented | [`test_copilot_complete_task_flow.py`](../ai-layer/tests/test_copilot_complete_task_flow.py) | #302 |
| COP-ASSIGN | `assign_task` with tenant-scoped `find_user` resolution and confirmation | Implemented | [`test_copilot_task_actions.py`](../ai-layer/tests/test_copilot_task_actions.py) | #297 |
| COP-NOTIFY | `send_notification` with channel/template/locale validation and dedupe | Implemented | [`test_copilot_task_actions.py`](../ai-layer/tests/test_copilot_task_actions.py) | #297 |
| COP-APPROVAL | Approval propose/confirm bound to tenant, user, payload hash and TTL | Implemented | [`test_copilot_approval_flow.py`](../ai-layer/tests/test_copilot_approval_flow.py) | #296 |
| COP-APPROVAL-NODE | Copilot approval task bound to a real APPROVAL node execution | Partial | [`test_copilot_approval_flow.py`](../ai-layer/tests/test_copilot_approval_flow.py) | #288 |
| COP-GUARDRAILS | Semantic input/output/tool policies with fail-closed high-risk actions | Implemented | [`test_copilot_semantic_guardrails.py`](../ai-layer/tests/test_copilot_semantic_guardrails.py) | #299 |
| COP-GUARDRAIL-LEGACY | Marker, zero-width and oversized input/output guardrails | Implemented | [`test_copilot_guardrails.py`](../ai-layer/tests/test_copilot_guardrails.py) | #299 |
| COP-ROUTING | Budget/latency/risk-aware routing with cost estimate and audit fields | Implemented | [`test_copilot_routing.py`](../ai-layer/tests/test_copilot_routing.py) | #300 |
| COP-LLM-BUDGET | Copilot monthly token budget and per-minute limit | Partial | [`test_llm_gateway.py`](../ai-layer/tests/test_llm_gateway.py) | #294 |
| COP-CACHE | Tenant/prompt/model-scoped LLM response cache | Implemented | [`test_response_cache.py`](../ai-layer/tests/test_response_cache.py) | #294 |
| COP-LLM-FALLBACK | Optional secondary provider with typed `LlmUnavailable` failure | Implemented | [`test_llm_gateway_api.py`](../ai-layer/tests/test_llm_gateway_api.py) | #294 |
| COP-PROMPTS | Versioned, hashed prompts reported in every response | Implemented | [`test_prompts.py`](../ai-layer/tests/test_prompts.py) | #279 |
| COP-KNOWLEDGE | Tenant-filtered knowledge search with the no-answer guard | Implemented | [`test_copilot_knowledge.py`](../ai-layer/tests/test_copilot_knowledge.py) | #281 |
| COP-SUMMARY | Grounded find-and-summarize with citations and audit metadata | Implemented | [`test_copilot_knowledge_summary.py`](../ai-layer/tests/test_copilot_knowledge_summary.py) | #303 |
| COP-E2E-KNOWLEDGE | Document indexing, tenant search and analytics aggregation end to end | Implemented | [`KnowledgeAnalyticsE2ETest.java`](../backend/identity/src/test/java/com/awap/analytics/application/KnowledgeAnalyticsE2ETest.java) | #308 |
| COP-IDEMPOTENCY | End-to-end idempotency keys, replay and conflict detection | Implemented | [`test_copilot_api.py`](../ai-layer/tests/test_copilot_api.py) | #283 |
| COP-JOBS | Asynchronous Copilot jobs with status and cancellation | Implemented | [`test_async_jobs.py`](../ai-layer/tests/test_async_jobs.py) | #— |
| COP-E2E | SPA → backend → AI layer journey through AI_TASK HITL to completion | Implemented | [`copilot-journey.spec.ts`](../frontend/e2e/copilot-journey.spec.ts) | #284 |
| COP-CHAT-UI | Conversation history, sessions, suggestions and chat metadata | Implemented | [`phase-9-ai-copilot.spec.ts`](../frontend/e2e/phase-9-ai-copilot.spec.ts) | Phase 9 |
| COP-STREAM-UI | Progressive answer reveal with cancel and first-token measurement | Implemented | [`phase-9-ai-copilot.spec.ts`](../frontend/e2e/phase-9-ai-copilot.spec.ts) | Phase 9 |
| COP-CITATIONS | Structured tenant citations and no-citation flag | Implemented | [`test_copilot_phase9.py`](../ai-layer/tests/test_copilot_phase9.py) | Phase 9 |
| COP-HITL-UI | Hash-bound approval panel; reject sends no action | Implemented | [`phase-9-ai-copilot.spec.ts`](../frontend/e2e/phase-9-ai-copilot.spec.ts) | Phase 9 |
| COP-AUDIT-UI | Deduplicated per-request audit view of tools and decisions | Implemented | [`phase-9-ai-copilot.spec.ts`](../frontend/e2e/phase-9-ai-copilot.spec.ts) | Phase 9 |

### Two independent LLM control planes

The Copilot (Python AI layer) and the AI workflow node (Java backend) each own model controls. They
do **not** share a ledger, so a claim about "the AI budget" must name the plane:

| Control | Copilot (AI layer) | AI workflow node (backend) |
|---|---|---|
| Budget | `LlmGateway` monthly token counter in process memory (`AI_LLM_MONTHLY_BUDGET_TOKENS`) — **partial**: a restart or a second replica starts from zero | `AiBudgetGuard` durable PostgreSQL UTC-month ledger with atomic reserve/refund/reconcile (#301) |
| Rate limit | `LlmGateway` per-tenant 60-second window in process memory | `AiRateLimiter` per-tenant sliding window, per replica (#282) |
| Cache | tenant + prompt hash + model response cache (#294) | per-instance LRU keyed by action + prompt hash |
| Fallback | optional secondary `LlmClient`, then typed `LlmUnavailable` (#294) | provider chain with circuit breakers and typed 502/504 (#307) |
| Routing | `ModelRouter` policy table using complexity, risk, remaining backend budget and latency budget (#300) | `AiModelRouter` cheap/standard/complex from request complexity and action risk |

Consequences: `GET /api/v1/ai/budget` reports the **AI node** ledger only. A Copilot-only deployment
has no durable spend record yet; a shared Copilot ledger is the follow-up to #294
(`COP-LLM-BUDGET`).

### HITL and APPROVAL-node linkage

- **AI workflow node HITL.** Below `awap.ai.confidence-threshold` the node moves to `WAITING` with
  `AI_HITL_REQUIRED`; the approval task stores the AI node execution id and approving it resumes the
  node through the normal APPROVAL semantics (#288, proven by #304).
- **Copilot HITL.** Workflow start, task decisions, assignment, notifications and approval
  assistance require an explicit second call; a confirmation is bound to a tenant/user-scoped
  proposal hash (#296).
- **Remaining gap.** The Copilot `create_approval` tool creates a normal task on the instance. It is
  not bound to an APPROVAL node execution, so approving it does not resume a waiting APPROVAL node.
  That is `COP-APPROVAL-NODE` (Partial, related implementation issue #288) and must not be described
  as a full approval-node integration.

## Tool permission matrix

| Tool | Required permission |
|---|---|
| `find_workflow` | `INSTANCE_READ` |
| `create_workflow_instance` | `INSTANCE_MANAGE` |
| `query_tasks` | `TASK_MANAGE` |
| `complete_task` | `TASK_MANAGE` (and the task service's decision right) |
| `assign_task` | `TASK_MANAGE` (tenant-scoped `find_user` resolution first) |
| `find_user` | `TASK_MANAGE` |
| `create_approval` | `TASK_MANAGE` |
| `send_notification` | `INSTANCE_MANAGE` |
| `search_documents` | `INSTANCE_READ` |
| `get_user` | authenticated caller |
| `audit_decision` | authenticated caller |

The AI layer also performs a local permission check before calling the backend; the backend check is
authoritative.

Cross-tenant authorization matrix (issue #305): every internal tool is driven with a caller from
tenant A and a forged tenant id in the body. The controller always uses the authenticated tenant from
the service headers, so the forged body tenant has no effect; each tool is verified against the
tenant-A service call and the tenant-B variant is asserted never to be invoked. The service token and
role are re-verified on every call, and a forged `X-User-Permissions` header is ignored because the
backend derives permissions from the verified role. Tests:
`InternalAiToolControllerTest.everyToolUsesTheAuthenticatedTenantAndIgnoresAForgedBodyTenant` and
`InternalAiToolAuthTest.ignoresAForgedPermissionsHeaderAndUsesTheVerifiedRole`.

## HTTP surfaces

### SPA-facing backend proxy

- `POST /api/v1/copilot/chat`
- `GET /api/v1/copilot/tasks`
- `POST /api/v1/copilot/tasks/{taskId}/complete`
- `POST /api/v1/copilot/approvals`
- `POST /api/v1/copilot/knowledge/search`
- `GET /api/v1/copilot/prompts`
- `GET /api/v1/copilot/metrics`

### AI layer

The same paths under the AI layer's `/api/v1` prefix, plus `workflows/discover` and
`workflows/initiate`.

### Internal tool API

`/internal/tools/{find_workflow,create_workflow_instance,query_tasks,complete_task,assign_task,find_user,create_approval,send_notification,search_documents,index_document,get_user,audit_decision}`

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AI_INTERNAL_TOKEN` | empty | Shared backend↔AI service credential; empty disables internal tools |
| `AI_COPILOT_ENABLED` | `false` | Enables the backend SPA proxy |
| `AI_COPILOT_TIMEOUT_MS` | `10000` | Copilot request timeout |
| `AI_RATE_LIMIT_PER_MINUTE` | `60` | Per-tenant AI call limit |
| `AI_CONFIDENCE_THRESHOLD` | `0.7` | Below this confidence the response is downgraded to HITL |
| `AI_KNOWLEDGE_MIN_SCORE` | `0.35` | Minimum top hit score for a knowledge answer |
| `AI_KNOWLEDGE_MIN_HITS` | `1` | Minimum hit count before knowledge confidence is discounted |
| `AI_MODEL_CHEAP` | `local-heuristic` | Cheap/simple tier model |
| `AI_MODEL_STANDARD` | `gpt-4o-mini` | Standard tier model |
| `AI_MODEL_COMPLEX` | `gpt-4o` | Complex/multi-step tier model |
| `AI_COPILOT_LLM_BASE_URL` | empty | Optional OpenAI-compatible chat endpoint |
| `AI_COPILOT_LLM_API_KEY` | empty | Optional provider key |
| `AI_LLM_MONTHLY_BUDGET_TOKENS` | `1000000` | Copilot per-tenant monthly token budget, in process memory (Partial, #294) |
| `AI_LLM_RATE_LIMIT_PER_MINUTE` | `60` | Copilot per-tenant per-minute limit, in process memory (Partial, #294) |
| `AI_LLM_CACHE_TTL_SECONDS` | `30` | Copilot response cache TTL; `0` disables the cache |
| `AI_LLM_CACHE_MAX_ENTRIES` | `256` | Copilot response cache size cap |
| `AI_LLM_COST_MICROS_PER_TOKEN` | `2` | Copilot cost estimate used by routing and usage rows |
| `AI_LLM_MAX_OUTPUT_TOKENS` | `1024` | Copilot output cap used for budget admission |
| `KNOWLEDGE_INDEX` | `awap-knowledge` | OpenSearch knowledge index name |
| `AI_LAYER_SERVICE_TOKEN` | empty | AI layer's expected service token |
| `AI_APPROVAL_PROPOSAL_TTL_SECONDS` | `900` | Lifetime of an unconfirmed approval proposal |
| `AI_APPROVAL_PROPOSAL_MAX_ENTRIES` | `1000` | Bounded proposal store capacity per agent process |
| `AI_GUARDRAIL_PROVIDER` | `heuristic` | Semantic classifier: `heuristic` or `nemo` |
| `NEMO_GUARDRAILS_URL` | empty | Optional NeMo Guardrails HTTP endpoint (`provider=nemo`) |
| `AI_GUARDRAIL_FAIL_CLOSED` | `true` | Block high-risk actions when the classifier is unavailable |
| `AI_GUARDRAIL_THRESHOLD_<POLICY>` | `0.6` | Per-policy score threshold (for example `..._PROMPT_INJECTION`) |

Production must supply `AI_INTERNAL_TOKEN` from Vault/External Secrets, never from a committed file.

## Knowledge no-answer guard (issue #281)

`app/copilot/knowledge.py` computes a server-side confidence from the hit count, the top score and
snippet relevance. The result is one of four audited outcomes:

| Outcome | When | Response |
|---|---|---|
| `SUCCESS` | Relevant hits and confidence ≥ threshold | Normal document summary |
| `LOW_CONFIDENCE` | Relevant hits but confidence < threshold | Explicit low-confidence answer, `requires_human_approval=true` |
| `NO_ANSWER` | No hits, or no snippet matches the query | Explicit "I don't know", `requires_human_approval=true` |
| `SEARCH_UNAVAILABLE` | Backend/OpenSearch failure or malformed payload | Explicit outage message; never claims no documents exist |

The guard is enforced after retrieval, so a model cannot ignore it. Every outcome increments
`copilot.knowledge.<outcome>` and is written to the audit row. The retrieval fixture at
`ai-layer/eval/knowledge_retrieval.v1.json` gates answer and document Precision/Recall at 0.85 in CI.

### Grounded find-and-summarize (issue #303)

On `SUCCESS`, `summarize_hits` builds a deterministic, bounded summary from the tenant-filtered
chunks. Each source is cited with its title, file id and chunk index, snippets are truncated to 320
characters and instruction-like sentences inside retrieved text are neutralized as untrusted data.
The audit row records `retrievedDocumentIds`, `retrievedChunkRefs`, `knowledgePromptKey`,
`knowledgePromptVersion` and `summaryTruncated`. A hit that carries a different `tenantId` is dropped
at the AI-layer boundary as a defensive check. Tests: `ai-layer/tests/test_copilot_knowledge_summary.py`.

## Golden-set evaluation (issue #279)

Workflow-matching accuracy is measured on the versioned dataset at
`ai-layer/eval/golden_set.v1.jsonl`. `ai-layer/eval/evaluate.py` runs the real classification and
workflow-discovery path, computes a confusion matrix plus Precision/Recall/F1, per-locale,
per-tenant, per-action and per-risk slices and a confidence calibration report, then compares the
run with `eval/baseline.v1.json`.

- PR CI runs deterministic recorded fixtures (`ai-layer/eval/fixtures/backend_tools.v1.json`);
  nightly runs use the live backend.
- Gates: Precision ≥ 0.90, Recall ≥ 0.90, and every slice with at least two samples ≥ 0.85.
- Every run is written to `ai-layer/eval/results/<date>-<git-sha>.json`.
- An empty or malformed dataset exits non-zero; a provider timeout marks the run incomplete
  instead of scoring it as zero.
- The full protocol, including how to add entries and approve a new baseline, is in
  `ai-layer/eval/README.md`.

## Durable monthly AI budget (issue #301)

`AiBudgetGuard` now reads and mutates the PostgreSQL ledger in `ai_budget_usage` through the atomic
`awap_ai_budget_*` functions. The budget window is the **UTC calendar month** (the period is the first
day of the month), so a new month starts a new ledger row and no timezone ambiguity exists.

- `reserve` is a single conditional UPDATE keyed by `(tenant, period)` plus an idempotency event row;
  concurrent replicas serialize on the row and cannot over-admit the cap. A replayed event key is
  idempotent.
- `refund` returns a failed provider call's reservation; `commit` reconciles the pre-call estimate
  with the provider's actual token count.
- A missing/unavailable ledger is **fail-closed** for quota-enforcing calls (`503`).
- Every reservation/refund/reconciliation updates Micrometer counters, and crossing 80%/100% emits
  `awap.ai.budget.utilization{state=near_limit|exhausted}` and a warning log.
- `GET /api/v1/ai/budget` returns the caller tenant's period, budget, used, reserved, remaining,
  utilization and `OK`/`NEAR_LIMIT`/`EXHAUSTED` warning.

Tests: `AiBudgetGuardDurabilityTest` (shared ledger across replicas, restart, UTC month boundary,
duplicate key, concurrency, refund/reconcile, fail-closed, snapshot) and
`AiBudgetPostgresTest` (real PostgreSQL atomic boundary, duplicate/refund/reconcile, RLS).

## Budget-aware routing (issue #300)

`ModelRouter` is a versioned policy table (`v1`). It receives server-derived routing metadata from
the backend-to-AI-layer security context — `remaining_budget_tokens`, `latency_budget_ms` and
`task_risk` — never from the SPA request body. The policy selects the tier in this order:

| Condition | Result |
|---|---|
| Complexity ≥ 0.65 | complex tier |
| 0.30 ≤ complexity < 0.65 | standard tier |
| Complexity < 0.30 | cheap tier |
| High-risk action, budget healthy | at least standard |
| Latency < 2 000 ms | complex → standard |
| Latency < 500 ms | standard → cheap |
| Remaining budget = 0 | cheapest tier |
| Remaining < estimated cost × 5 | downgrade one tier (high-risk floors at standard) |

The response exposes `routing_reason`, `routing_policy` and `estimated_cost_micros`; the audit row
also records `remainingBudgetTokens`, `latencyBudgetMs`, the complexity and whether a downgrade
happened. A policy exception falls back to the cheapest safe tier and is audited. Malformed latency
metadata uses the documented default, negative budget is treated as exhausted, and a client-supplied
budget field in the request body is ignored.

Tests: `ai-layer/tests/test_copilot_routing.py` covers every boundary, costs, the exception fallback,
an exhaustive policy-combination property test and an integration test that the agent passes budget
and latency into `ModelRouter.route` and the audit row. On the backend,
`AiRoutingFallbackE2ETest` drives the real AI node + agent + provider gateway: cheap/complex model
selection, token/cost metrics, 429/timeout fallback with a fallback counter, all-provider failure as a
typed 502, and budget exhaustion returning 429 with zero provider calls.

## Semantic guardrails (issue #299)

`app/copilot/semantic_guardrails.py` is a provider-neutral guardrail stage around every LLM call:

- **Input policies** (before the model): prompt injection, jailbreak, system-prompt leakage request,
  harmful content and PII. **Output policies** (after the model): system-prompt leakage, harmful
  content and PII. **Tool policy** (before a state-changing tool): tool misuse.
- The default `HeuristicSemanticClassifier` normalizes Unicode (NFKC), strips zero-width characters,
  decodes base64 payloads and combines phrase families with token co-occurrence, so paraphrased,
  encoded and obfuscated attacks are detected without an exact marker. The optional
  `NemoGuardrailsClassifier` calls a configured NeMo Guardrails HTTP endpoint.
- A policy score at or above its threshold blocks the request (or redacts PII). A classifier outage
  fails **closed** for high-risk actions (`start_workflow`, `complete_task`, `assign_task`,
  `send_notification`, `approval_assistance`) and is recorded as `guardrailUnavailable`.
- Every decision is written to the audit row with `guardrailPolicy`, `guardrailDecision`,
  `guardrailScore` and `guardrailVersion`.
- The versioned red-team dataset at `ai-layer/eval/red_team_guardrails.v1.jsonl` is evaluated by
  `ai-layer/eval/guardrail_eval.py`; PR CI enforces precision ≥ 0.90, recall ≥ 0.90 and a
  false-positive rate ≤ 0.10 through `test_copilot_semantic_guardrails.py`.

## Approval HITL two-step contract (issue #296)

`POST /api/v1/copilot/approvals` never sets `confirm_high_risk` on the caller's behalf. The request
must carry an explicit `confirm` flag, and confirmation is bound to the proposal it proposes:

1. **Propose.** With `confirm=false` (the default) the agent creates a tenant- and user-scoped
   proposal, returns `requires_human_approval=true`, and returns `proposalId`, `proposalHash` and
   `expiresAt` in `data`. It records an audit row with `outcome=PROPOSED` and calls no domain tool,
   so no approval task exists after this call.
2. **Confirm.** With `confirm=true` the caller must send the same payload plus `proposal_id` and
   `proposal_hash`. The agent verifies the tenant/user scope, expiry, supplied hash and recomputed
   payload hash before calling `create_approval`. The proposal id is used as the tool's
   `Idempotency-Key`, so a replayed confirmation returns the existing task instead of creating a
   second one and records an audit row with `outcome=CONFIRMED`.

A missing proposal, an expired proposal, a payload change, a different user/tenant or a malformed
hash fails closed: no tool is called, no task is created, and the response carries
`requires_human_approval=true` plus a stable `data.errorCode`
(`PROPOSAL_REQUIRED`, `PROPOSAL_UNKNOWN_OR_EXPIRED`, `PROPOSAL_PAYLOAD_MISMATCH`). Proposal TTL is
`AI_APPROVAL_PROPOSAL_TTL_SECONDS` (default 900 seconds). The SPA sends the proposal fields only on
the confirmed second click; the transport never fabricates them.

Tests: `ai-layer/tests/test_copilot_approval_flow.py` (proposal-only first call, exactly one task on
confirmation, duplicate idempotency, expiry, tenant isolation, payload binding and audit outcomes)
and `ai-layer/tests/test_copilot_api.py` (the HTTP contract).

## End-to-end idempotency (issue #283)

- The Copilot UI generates one key per submitted intent, reuses it for retries of the same text,
  and rotates it after a successful turn or when the request text changes.
- The key travels as the `Idempotency-Key` header and the `idempotency_key` body field. The backend
  proxy forwards both unchanged to the AI layer, and the AI layer passes it to
  `create_workflow_instance`, `complete_task` and `create_approval`.
- `IdempotencyFilter` stores `(tenant_id, idempotency_key)` plus a SHA-256 hash of the method, path,
  query and body. An identical repeat replays the stored response; the same key with a different
  payload returns `409`; concurrent duplicates execute the downstream handler exactly once.
- `workflow_instances` has a unique `(tenant_id, idempotency_key)` constraint. The engine replays an
  existing instance only when the workflow and context match, otherwise it returns
  `409 RESOURCE_CONFLICT`.
- Keys are retained by `IdempotencyPurgeScheduler`; an expired key is treated as new.

## Rate-limit and burst behaviour (issues #282, #294)

There are two separate limiters:

- **AI workflow node.** `AiRateLimiter` is a per-tenant 60-second sliding window that admits at most
  `AI_RATE_LIMIT_PER_MINUTE` AI calls (default 60). The check runs before model routing, the token
  budget and metering, so a rejected call never reaches the provider and never consumes budget. A
  rejection is a `429 QUOTA_EXCEEDED` Problem Details response with the correlation ID echoed back
  to the client. Concurrent bursts, per-tenant isolation, window recovery, a clock that moves
  backward and interrupt preservation are proven by `AiRateLimiterConcurrencyTest`;
  `AiRateLimitHttpMappingTest` proves the 429 contract and `AiNodeServiceTest` proves the provider
  and budget counters are untouched on a rejected call.
- **Copilot.** `LlmGateway` enforces `AI_LLM_RATE_LIMIT_PER_MINUTE` (default 60) per tenant and
  returns a typed `LlmRateLimited` with `retry_after_seconds` before the provider call, proven by
  [`test_llm_gateway.py`](../ai-layer/tests/test_llm_gateway.py).

Both limiters are in-memory and therefore per replica. A multi-replica deployment needs a shared
store; the Copilot `UsageStore` protocol is the migration seam (`COP-LLM-BUDGET`, Partial).

## Failure behaviour

- Missing service token: `401`, no tool runs.
- Role lacks the required permission: `403`, no domain service is invoked.
- Prompt injection or output leakage: blocked and audited.
- Low confidence: `requires_human_approval=true`; state-changing tools are not called.
- Knowledge search: empty or irrelevant results return an explicit `NO_ANSWER`; a low score returns
  `LOW_CONFIDENCE`; both set `requires_human_approval=true`.
- OpenSearch unavailable: knowledge search returns `SEARCH_UNAVAILABLE` and increments the outcome
  counter; it never returns another tenant's data and never claims no documents exist.
- Model provider 429/5xx/transport failure: the backend AI node walks its provider chain, which
  includes the local heuristic provider and per-provider circuit breakers; when every provider fails
  the request is a typed `502`/`504` (#307). The Copilot gateway tries its optional secondary
  provider and then returns a typed `LlmUnavailable` instead of inventing an answer.
- Metering or budget exhaustion: `429` before the model is called.
- Per-tenant AI rate limit: `429` before routing, budget or the provider is touched; admitted and
  rejected counts are exposed as `awap.ai.requests{outcome=success|rate_limited}`.

## Tests

- AI layer: `ai-layer/tests/test_copilot_*.py` (guardrails, routing, permissions, agent flows, API
  contract), `ai-layer/tests/test_copilot_eval.py` (golden-set metrics, slices, baseline diff,
  exit codes and artifact contents), `ai-layer/tests/test_copilot_split_brain.py` (C5
  fault-injection, concurrent idempotency and restart recovery) and
  `ai-layer/tests/test_copilot_knowledge.py` (no-answer/low-confidence guard and retrieval gate).
- Backend: `AiModelRouterTest`, `AiRateLimiterTest`, `AiRateLimiterConcurrencyTest`,
  `AiRateLimitHttpMappingTest`, `AiGuardrailsOutputTest`, `KnowledgeChunkingServiceTest`,
  `KnowledgeSearchServiceTest`, `InternalAiToolAuthTest`, `KnowledgeAnalyticsE2ETest` (deterministic
  index → search → analytics journey) and `KnowledgeAnalyticsOpenSearchIntegrationTest` (the same
  journey against a real OpenSearch container).
- E2E: `frontend/e2e/copilot-journey.spec.ts` runs the full Phase 2 journey against the real stack
  (natural language, confirmation, one instance, AI_TASK low-confidence HITL, human approval,
  completion, correlation IDs, metrics and no duplicate instance/task). The nightly
  `frontend/e2e/copilot-live-provider.spec.ts` variant is gated by `E2E_AI_LIVE_PROVIDER=1` and a
  configured OpenAI-compatible provider; PR CI always uses the deterministic local heuristic.
- Existing AI node, SCRIPT sandbox, notification and engine suites remain unchanged.

## Prompt governance

Prompt files are immutable, versioned, hashed and gated by CI. See
[ADR-0008](adr/0008-ai-prompt-versioning-and-change-control.md). Every response reports
`prompt_key`, `prompt_version` and `prompt_hash`; the `audit_decision` tool receives the same
metadata, so a decision can be traced back to the exact immutable prompt file.

## Phase 9 SPA experience

The `/copilot` screen adds conversation history (tenant-scoped in browser storage), suggestion
cards, progressive answer reveal with cancel, tool-call cards with redacted arguments, citations,
no-answer/low-confidence states, a hash-bound HITL approval panel, an audit view, budget usage and
injection/PII warnings. See
[`ui-ux/phase-9-ai-copilot.md`](ui-ux/phase-9-ai-copilot.md).

Response metadata added in this phase: `outcome`, `citations`, `budget`, `warnings`, `guardrail` and
`audit`. The gRPC adapter projects the REST envelope onto the proto fields, so the versioned proto
contract is unchanged.

Honest limitations:

- **Streaming transport.** The browser progressively reveals a completed response; the backend proxy
  is request/response, so token-level provider streaming over SSE/WebSocket is not implemented.
- **Sessions.** The AI layer is stateless; history is browser storage, not a durable server session.
- **Citation coverage.** Citations exist for `knowledge_search` answers. Workflow/task/notification
  answers reference their tool calls instead of documents.
- **Budget ledger.** Remaining budget is the backend-supplied routing value or the in-process
  Copilot gateway ledger; it is not the durable AI-node ledger.

## Documentation review checklist

Use this checklist for every change to this document or to
[`ai-and-script-security.md`](ai-and-script-security.md). It is enforced by CI, not only by review.

- [ ] Every capability is listed in the capability matrix with `Implemented`, `Partial` or
      `Planned`; the status is copied from the code, not from the plan.
- [ ] An `Implemented` row links the automated test that would fail if the behaviour regressed.
- [ ] A `Partial` or `Planned` row links the issue that closes the gap and states the limitation.
- [ ] Budget, rate-limit, cache, fallback and routing claims name the control plane
      (Copilot AI layer or AI workflow node); no claim implies a shared ledger.
- [ ] HITL claims distinguish the AI node's APPROVAL-node linkage from the Copilot's standalone
      approval task.
- [ ] `node scripts/check-capability-matrix.mjs` and `node scripts/check-doc-links.mjs` pass.
- [ ] New metrics, configuration variables and endpoints added by the change are documented.

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

## Implemented capabilities

| Capability | Implementation |
|---|---|
| Workflow discovery | `find_workflow` searches published workflows in the caller's tenant |
| Workflow initiation | `create_workflow_instance` uses the existing engine and `Idempotency-Key` |
| Task query | `query_tasks` lists the caller's tasks |
| Task completion | `complete_task` supports approve, reject and complete |
| Approval assistance | `create_approval` creates a tenant-scoped approval task |
| Notification | `send_notification` uses the durable notification delivery path |
| Knowledge search | `search_documents` queries the tenant-filtered OpenSearch knowledge index |
| Audit | `audit_decision` writes an immutable `automation_audit_records` row |
| Prompt injection | Input guardrails reject injection markers, zero-width obfuscation and oversized input |
| Output guardrails | System-prompt leakage and oversized completions are blocked |
| HITL | Starting a workflow, task decisions and approvals require explicit confirmation; an AI workflow node below the confidence threshold creates a node-linked approval task |
| Model routing | Deterministic cheap/standard/complex routing by complexity, action and latency |
| Cost controls | Monthly token budget, per-tenant rate limit, cache and provider fallback |
| Prompt versioning | Prompts live under `ai-layer/app/prompts/*-v1.md`; every response reports `v1` |
| Knowledge chunking | Sentence-aware chunks with overlap, indexed in OpenSearch and filtered by tenant |
| Automatic indexing | The `document.events` consumer indexes each registered/created version best-effort; OpenSearch failures never fail the document consumer |

## Tool permission matrix

| Tool | Required permission |
|---|---|
| `find_workflow` | `INSTANCE_READ` |
| `create_workflow_instance` | `INSTANCE_MANAGE` |
| `query_tasks` | `TASK_MANAGE` |
| `complete_task` | `TASK_MANAGE` (and the task service's decision right) |
| `assign_task` | `TASK_MANAGE` |
| `create_approval` | `TASK_MANAGE` |
| `send_notification` | `INSTANCE_MANAGE` |
| `search_documents` | `INSTANCE_READ` |
| `get_user` | authenticated caller |
| `audit_decision` | authenticated caller |

The AI layer also performs a local permission check before calling the backend; the backend check is
authoritative.

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

`/internal/tools/{find_workflow,create_workflow_instance,query_tasks,complete_task,assign_task,create_approval,send_notification,search_documents,index_document,get_user,audit_decision}`

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
| `KNOWLEDGE_INDEX` | `awap-knowledge` | OpenSearch knowledge index name |
| `AI_LAYER_SERVICE_TOKEN` | empty | AI layer's expected service token |

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

## Failure behaviour

- Missing service token: `401`, no tool runs.
- Role lacks the required permission: `403`, no domain service is invoked.
- Prompt injection or output leakage: blocked and audited.
- Low confidence: `requires_human_approval=true`; state-changing tools are not called.
- Knowledge search: empty or irrelevant results return an explicit `NO_ANSWER`; a low score returns
  `LOW_CONFIDENCE`; both set `requires_human_approval=true`.
- OpenSearch unavailable: knowledge search returns `SEARCH_UNAVAILABLE` and increments the outcome
  counter; it never returns another tenant's data and never claims no documents exist.
- Model provider 429/5xx/transport failure: backend AI node falls back to the local heuristic
  provider; the Copilot surface reports the failure instead of inventing an answer.
- Metering or budget exhaustion: `429` before the model is called.

## Tests

- AI layer: `ai-layer/tests/test_copilot_*.py` (guardrails, routing, permissions, agent flows, API
  contract), `ai-layer/tests/test_copilot_eval.py` (golden-set metrics, slices, baseline diff,
  exit codes and artifact contents), `ai-layer/tests/test_copilot_split_brain.py` (C5
  fault-injection, concurrent idempotency and restart recovery) and
  `ai-layer/tests/test_copilot_knowledge.py` (no-answer/low-confidence guard and retrieval gate).
- Backend: `AiModelRouterTest`, `AiRateLimiterTest`, `AiGuardrailsOutputTest`,
  `KnowledgeChunkingServiceTest`, `KnowledgeSearchServiceTest`, `InternalAiToolAuthTest`.
- Existing AI node, SCRIPT sandbox, notification and engine suites remain unchanged.

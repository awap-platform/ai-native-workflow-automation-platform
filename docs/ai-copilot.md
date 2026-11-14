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

## Implemented capabilities

| Capability | Implementation |
|---|---|
| Workflow discovery | `find_workflow` searches published workflows in the caller's tenant |
| Workflow initiation | `create_workflow_instance` uses the existing engine and `Idempotency-Key` |
| Task query | `query_tasks` lists the caller's tasks |
| Task completion | `complete_task` supports approve, reject and complete |
| Approval assistance | `create_approval` creates a tenant-scoped approval task |
| Notification | `send_notification` uses the durable notification delivery path |
| Knowledge search | `search_documents` queries the tenant knowledge index with metadata fallback |
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
| `AI_MODEL_CHEAP` | `local-heuristic` | Cheap/simple tier model |
| `AI_MODEL_STANDARD` | `gpt-4o-mini` | Standard tier model |
| `AI_MODEL_COMPLEX` | `gpt-4o` | Complex/multi-step tier model |
| `AI_COPILOT_LLM_BASE_URL` | empty | Optional OpenAI-compatible chat endpoint |
| `AI_COPILOT_LLM_API_KEY` | empty | Optional provider key |
| `KNOWLEDGE_INDEX` | `awap-knowledge` | OpenSearch knowledge index name |
| `AI_LAYER_SERVICE_TOKEN` | empty | AI layer's expected service token |

Production must supply `AI_INTERNAL_TOKEN` from Vault/External Secrets, never from a committed file.

## Failure behaviour

- Missing service token: `401`, no tool runs.
- Role lacks the required permission: `403`, no domain service is invoked.
- Prompt injection or output leakage: blocked and audited.
- Low confidence: `requires_human_approval=true`; state-changing tools are not called.
- OpenSearch unavailable: knowledge search falls back to tenant document metadata.
- Model provider 429/5xx/transport failure: backend AI node falls back to the local heuristic
  provider; the Copilot surface reports the failure instead of inventing an answer.
- Metering or budget exhaustion: `429` before the model is called.

## Tests

- AI layer: `ai-layer/tests/test_copilot_*.py` (guardrails, routing, permissions, agent flows, API
  contract).
- Backend: `AiModelRouterTest`, `AiRateLimiterTest`, `AiGuardrailsOutputTest`,
  `KnowledgeChunkingServiceTest`, `KnowledgeSearchServiceTest`, `InternalAiToolAuthTest`.
- Existing AI node, SCRIPT sandbox, notification and engine suites remain unchanged.

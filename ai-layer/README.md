# AWAP AI Layer

FastAPI service for the AI layer. This README describes what the service does
**today**, not what it is intended to become.

## Capability matrix

| Capability | Status | Notes |
|---|---|---|
| `GET /api/v1/health` | Implemented | Liveness + version/build metadata |
| `GET /api/v1/health/live` | Implemented | Kubernetes liveness probe |
| `GET /api/v1/health/ready` | Implemented | Dependency-aware readiness (503 when down) |
| Versioned OpenAPI contract | Implemented | [contract](../docs/openapi/ai-layer-openapi.yaml) |
| LangGraph | Implemented | Agent graph with a fallback-safe optional import; `langchain` is not installed (ADR-0009) |
| Copilot chat/tasks/approvals | Implemented | `app/api/copilot.py` and `app/copilot/agent.py` |
| Permission-checked tools | Implemented | `create_workflow_instance`, `assign_task`, `find_workflow`, `get_user`, `send_notification`, `search_documents`, `create_approval`, `query_tasks`, `complete_task`, `audit_decision` |
| Versioned prompts | Implemented | `app/prompts/*-v1.md`, reported as `prompt_version` |
| Knowledge search | Implemented | Calls the backend tenant-scoped knowledge endpoint |
| Knowledge retrieval | Implemented in the backend | Hybrid lexical/vector OpenSearch search; the AI layer calls the backend `search_documents` tool |

The backend now calls the AI layer through the authenticated `/api/v1/copilot/*` proxy when
`AI_COPILOT_ENABLED=true`. The AI layer calls back into the backend's `/internal/tools/*` API with
the shared `AI_INTERNAL_TOKEN`; every tool re-verifies the user's role and tenant.

## Endpoints

### `GET /api/v1/health`

```json
{
  "status": "UP",
  "service": "ai-layer",
  "version": "0.1.0",
  "build": "local",
  "python": "3.15.0"
}
```

`build` comes from `AI_LAYER_BUILD_SHA` (default `local`); `version` comes from
the installed package or `AI_LAYER_VERSION`.

### `GET /api/v1/health/live`

Returns the same body as `/health`. It never probes dependencies.

### `GET /api/v1/health/ready`

Returns the same body plus `dependency`:

- `none` when `AI_LAYER_DEPENDENCY_URL` is unset (the current default);
- `HTTP <status>` when the dependency answers;
- the exception name (for example `ConnectError`) and HTTP **503** with
  `status: DOWN` when the dependency is unreachable.

Configure the probe with:

| Variable | Default | Purpose |
|---|---|---|
| `AI_LAYER_DEPENDENCY_URL` | unset | Optional readiness dependency URL |
| `AI_LAYER_DEPENDENCY_TIMEOUT_SECONDS` | `2.0` | Probe timeout |
| `AI_LAYER_VERSION` | package version | Reported version |
| `AI_LAYER_BUILD_SHA` | `local` | Reported build SHA |

## Run and test

```bash
uv sync --locked
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
```

OpenAPI JSON is served at `/api/v1/openapi.json`. The versioned human contract is
[`docs/openapi/ai-layer-openapi.yaml`](../docs/openapi/ai-layer-openapi.yaml).

## Compatibility

See [`COMPATIBILITY.md`](COMPATIBILITY.md) for the Python 3.15 / LangGraph
compatibility notes. The `langchain` meta-package was removed because it was
never imported; [`docs/adr/0009-ai-langgraph-not-langchain.md`](../docs/adr/0009-ai-langgraph-not-langchain.md)
records the decision and CI enforces that every runtime dependency is used.

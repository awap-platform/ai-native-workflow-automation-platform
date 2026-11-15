# AI Layer Compatibility

Pilot compatibility report for the AI layer on Python 3.15.0.

## Result

✅ All C-based dependencies compile/import and run a smoke assertion on Python 3.15.0.

| Dependency | Kind | Verified |
|---|---|---|
| grpcio | C-based | ✅ `grpc.__version__` |
| protobuf | C-based | ✅ via `grpc` / `google.protobuf` |
| pydantic-core | C-based | ✅ `SchemaValidator` available |
| fastapi | pure | ✅ via `uv sync --locked` |
| uvicorn | pure | ✅ via `uv sync --locked` |
| httpx | pure | ✅ via `uv sync --locked` |
| langgraph | pure | ✅ 1.2.15 |

## How to reproduce

```bash
uv sync --locked
uv run python compat_check.py
```

## Notes

- Python is pinned to 3.15.0 via `ai-layer/.python-version` and `requires-python`.
- `uv.lock` is committed and CI enforces `uv sync --locked`.
- `environment.yml` (conda) was removed; the layer is now uv-managed.

## Runtime contract and limits (issue #185)

- The only implemented API surface is the health contract:
  `/api/v1/health`, `/api/v1/health/live` and `/api/v1/health/ready`.
- The versioned contract is
  [`docs/openapi/ai-layer-openapi.yaml`](../docs/openapi/ai-layer-openapi.yaml).
  A pytest contract test fails when the documented paths, status/body or
  version drift from the running app.
- LangGraph 1.2.15 is installed and compatibility-tested on Python 3.15. The
  `langchain` meta-package, `numpy` and `orjson` were removed because the code
  never imported them (issue #295 / ADR-0009). `scripts/check-python-deps.mjs`
  fails CI when a runtime dependency is unused.
- `/api/v1/health/ready` is dependency-aware: with
  `AI_LAYER_DEPENDENCY_URL` set, an unreachable dependency produces HTTP 503
  with `status: DOWN` and the dependency exception name.
- Python 3.15 compatibility for the C-based dependencies is verified by
  `compat_check.py`; a Python minor-version bump requires re-running it and
  updating `uv.lock`.

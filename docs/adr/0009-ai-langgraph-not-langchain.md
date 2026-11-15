# ADR-0009: LangGraph, not the LangChain meta-package

- Status: Accepted
- Date: 2026-11-15
- Issue: #295

## Context

`ai-layer/pyproject.toml` declared both `langchain` and `langgraph`. The agent imports
`langgraph.graph` directly (inside an optional-import guard) and never imports `langchain`,
`langchain_core` or any LangChain tool/model/memory abstraction. The plan says
"LangGraph/LangChain", so an unused package made the intended architecture ambiguous and increased
supply-chain and image surface.

`numpy` and `orjson` were also declared only to let `compat_check.py` prove C-based wheels work;
the application never imported them.

## Decision

- Keep **LangGraph** as the agent's internal planning state machine. It is the only orchestration
  library the Copilot uses.
- Remove the **`langchain` meta-package**. LangGraph declares its own `langchain-core` dependency
  where it needs shared message/runnable types; the meta-package adds no used capability.
- Remove `numpy` and `orjson`. The Python 3.15 C-based wheel check uses `grpcio` and
  `pydantic_core` instead, which are actually shipped.
- Add `scripts/check-python-deps.mjs` to CI: every `[project].dependencies` entry must be imported
  by `ai-layer/app` or `ai-layer/eval`, unless allowlisted as used outside Python (currently only
  `uvicorn`, the Docker entrypoint).

## Consequences

- The AI-layer image and SBOM contain only the runtime packages the code uses.
- A future contributor cannot add an unused runtime dependency without a red CI check.
- LangChain tools/models/memory are intentionally **not** part of the architecture. If a future
  feature needs them, it must add the specific package and update this ADR and the usage alias map.
- LangGraph remains optional at runtime: if it is missing, the deterministic step-by-step fallback
  in `CopilotAgent.run` keeps the service usable.

## Alternatives considered

1. **Use LangChain tools/models instead of the custom tool registry.** Rejected: the current
   registry enforces tenant-scoped backend permissions per call and is already audited; adopting
   LangChain tools would not remove that boundary and would add a second abstraction layer.
2. **Keep `langchain` "for future use".** Rejected: unused runtime dependencies hide supply-chain
   risk and contradict the dependency-usage requirement.
3. **Drop LangGraph too and hand-roll the state machine.** Rejected: LangGraph already provides the
   testable graph boundary with a deterministic fallback, and issue #295 only questions LangChain.

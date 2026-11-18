# AI node and SCRIPT sandbox — security design

Issue #132 enables the `AI` workflow node and adds a `SCRIPT` node. Both are **fail-closed**: they
return `501 Not Implemented` unless the deployment explicitly enables them
(`AI_NODE_ENABLED=true`, `SCRIPT_NODE_ENABLED=true`).

## Capability status

Status legend: **Implemented** means code plus an automated test; **Partial** means implemented with
a documented limitation; **Planned** means not implemented yet.
[`scripts/check-capability-matrix.mjs`](../scripts/check-capability-matrix.mjs) fails CI when an
Implemented row has no test link or a Partial/Planned row has no issue link.

| ID | Capability | Status | Evidence | Issue |
|---|---|---|---|---|
| AINODE-FLAG | AI node fails closed behind `AI_NODE_ENABLED` | Implemented | [`AiNodeServiceTest.java`](../backend/identity/src/test/java/com/awap/ai/application/AiNodeServiceTest.java) | #132 |
| AINODE-PROVIDER | Provider abstraction with local heuristic and OpenAI-compatible providers | Implemented | [`AiProviderGatewayTest.java`](../backend/identity/src/test/java/com/awap/ai/application/AiProviderGatewayTest.java) | #307 |
| AINODE-GUARDRAILS | Prompt sanitization and injection markers | Implemented | [`AiGuardrailsTest.java`](../backend/identity/src/test/java/com/awap/ai/domain/AiGuardrailsTest.java) | #132 |
| AINODE-TIMEOUT | Bounded provider call with timeout | Implemented | [`AiAgentServiceTest.java`](../backend/identity/src/test/java/com/awap/ai/application/AiAgentServiceTest.java) | #132 |
| AINODE-HITL | Low confidence moves the node to WAITING with a node-linked approval task | Implemented | [`NodeExecutorAiHitlTest.java`](../backend/identity/src/test/java/com/awap/engine/application/NodeExecutorAiHitlTest.java) | #288 |
| AINODE-BUDGET | Durable UTC-month ledger with atomic reserve/refund/reconcile | Implemented | [`AiBudgetGuardDurabilityTest.java`](../backend/identity/src/test/java/com/awap/ai/application/AiBudgetGuardDurabilityTest.java) | #301 |
| AINODE-BUDGET-DB | Real PostgreSQL atomic boundary, idempotency and RLS | Implemented | [`AiBudgetPostgresTest.java`](../backend/identity/src/test/java/com/awap/ai/infrastructure/AiBudgetPostgresTest.java) | #301 |
| AINODE-RATE | Per-tenant sliding-window rate limit before the provider call | Implemented | [`AiRateLimiterConcurrencyTest.java`](../backend/identity/src/test/java/com/awap/ai/application/AiRateLimiterConcurrencyTest.java) | #282 |
| AINODE-OUTPUT | System-prompt leakage and oversized output are blocked | Implemented | [`AiGuardrailsOutputTest.java`](../backend/identity/src/test/java/com/awap/ai/domain/AiGuardrailsOutputTest.java) | #132 |
| AINODE-ROUTING | Cheap/standard/complex model selection from complexity and action risk | Implemented | [`AiModelRouterTest.java`](../backend/identity/src/test/java/com/awap/ai/domain/AiModelRouterTest.java) | #— |
| AINODE-FALLBACK | Provider chain with circuit breakers, typed 502/504 and zero calls on budget exhaustion | Implemented | [`AiRoutingFallbackE2ETest.java`](../backend/identity/src/test/java/com/awap/ai/application/AiRoutingFallbackE2ETest.java) | #307 |
| AINODE-AUDIT | Every decision writes an immutable audit row | Implemented | [`AiNodeServiceTest.java`](../backend/identity/src/test/java/com/awap/ai/application/AiNodeServiceTest.java) | #132 |
| SCRIPT-SANDBOX | Deny-by-construction expression sandbox with no host access | Implemented | [`ScriptSandboxTest.java`](../backend/identity/src/test/java/com/awap/script/application/ScriptSandboxTest.java) | #298 |
| SCRIPT-MATRIX | Allowed/denied construct matrix and deterministic fuzz loop | Implemented | [`ScriptSandboxSecurityMatrixTest.java`](../backend/identity/src/test/java/com/awap/script/application/ScriptSandboxSecurityMatrixTest.java) | #298 |
| SCRIPT-NETWORK | Network, filesystem, reflection and SSRF payloads are rejected | Implemented | [`ScriptSandboxNetworkTest.java`](../backend/identity/src/test/java/com/awap/script/application/ScriptSandboxNetworkTest.java) | #306 |
| SCRIPT-FLAG | SCRIPT node fails closed when disabled or the sandbox is absent | Implemented | [`ScriptNodeServiceTest.java`](../backend/identity/src/test/java/com/awap/script/application/ScriptNodeServiceTest.java) | #132 |
| SCRIPT-OUTPUT | Context and result are validated as JSON primitives and audited | Implemented | [`ScriptNodeServiceTest.java`](../backend/identity/src/test/java/com/awap/script/application/ScriptNodeServiceTest.java) | #306 |

## AI node and AI_TASK alias

`AI_TASK` is an explicit alias of the `AI` execution path, so existing published definitions keep
working while new definitions can use the spec's `AI_TASK` name. Both are `ENFORCED` for timeout
purposes and share the same guardrails, budget, cache, HITL and audit behavior.

| Control | Implementation |
|---|---|
| Provider abstraction | `AiBackendClient` seam + `AiAgentService` (timeout, validation); `LocalHeuristicAiBackend` is the default, `OpenAiCompatibleAiBackend` (`AI_PROVIDER=openai`) calls any OpenAI-compatible `/chat/completions` endpoint with a connect/read timeout and falls back to the local provider on 429/5xx/transport/empty answers |
| Prompt sanitization / guardrails | `AiGuardrails` strips NUL characters, caps the prompt at 8 000 chars and blocks `[INST]`, `<\|`, "ignore previous instructions", "system prompt", "reveal your instructions", "you are now", "jailbreak", "developer mode" and role-spoofing markers. The Copilot adds the semantic guardrail layer from issue #299 (prompt injection, jailbreak, leakage, harmful content, PII, tool misuse) with fail-closed behavior for high-risk actions and audited policy/decision/score/version fields |
| Timeout | `AiAgentService` runs the provider call on a bounded executor with `awap.ai.timeout-ms` (default 5 000 ms) |
| Confidence + HITL | `AiConfidenceEstimator` (deterministic, explainable) → below `awap.ai.confidence-threshold` (0.7) the node transitions to `WAITING` with `AI_HITL_REQUIRED` and creates an idempotent approval task tied to the node execution; approving it advances the workflow through the normal task completion path |
| Budget / cost | `AiBudgetGuard` reserves estimated tokens in the durable PostgreSQL UTC-month ledger (`awap.ai.monthly-token-budget`, default 200 000) and refuses with `429`; reservations/refunds/reconciliation are atomic and idempotent, a missing ledger fails closed with `503`, and cost is recorded at `awap.ai.cost-micros-per-token`. **Scope: AI workflow node only.** The Copilot has a separate AI-layer gateway whose budget, rate-limit and usage store are in process memory (`COP-LLM-BUDGET`, Partial) |
| Rate limit | `AiRateLimiter` enforces a per-tenant sliding window (`awap.ai.rate-limit-per-minute`, default 60) before the provider call |
| Output guardrail | `AiGuardrails.sanitizeOutput` blocks system-prompt leakage and oversized completions |
| Model routing | `AiModelRouter` selects cheap/standard/complex tiers from request complexity and action risk; it does **not** use the latency budget, because budget/latency-aware routing is the Copilot AI-layer `ModelRouter` (#300). The model and tier are audited |
| Rate/caching | Per-instance LRU cache keyed by the SHA-256 of action+prompt (`awap.ai.requests{outcome="cache_hit"}`); repeated prompts never hit the provider |
| Fallback | The provider gateway tries the primary, the configured fallback order and the remaining registered providers (including the local heuristic) with per-provider circuit breakers. When every provider fails the response is a typed `502`/`504` and the node fails the instance; a failed provider call refunds its reservation (#307) |
| Audit | Every decision (success, blocked, budget, cache hit, HITL) writes an immutable `automation_audit_records` row with prompt hash, confidence, tokens and cost |

### Scope of the AI node guarantees

These controls exist on the Java `AI`/`AI_TASK` execution path. They are not shared with the Python
Copilot, which has its own gateway (see
[`ai-copilot.md`](ai-copilot.md#two-independent-llm-control-planes)):

- The durable monthly ledger, `GET /api/v1/ai/budget` and the fail-closed `503` apply to AI node
  calls. The Copilot budget is a per-process counter, so a Copilot-only deployment has no durable
  spend record yet.
- The per-tenant sliding window is per backend replica for both planes; a multi-replica deployment
  needs a shared store.
- The AI node routes on complexity and action risk; latency and remaining-budget routing belongs to
  the Copilot `ModelRouter` (#300).
- Provider fallback is the backend gateway chain with circuit breakers (#307). The Copilot gateway
  has its own optional secondary provider and returns a typed `LlmUnavailable`.

## SCRIPT node

| Control | Implementation |
|---|---|
| Sandbox choice | In-process **expression sandbox** (`ScriptSandbox`): scripts are parsed into a tiny grammar instead of executing JVM bytecode, so filesystem, network, reflection, process execution and imports are not expressible at all |
| Allowed syntax | numbers, strings, booleans, `ctx.field` reads, `+ - * / %`, comparisons, `and`/`or`/`not`, and the whitelisted functions `len`, `upper`, `lower`, `coalesce`, `abs` |
| Denied by construction | method calls (`ctx.x.getClass()`), unknown identifiers (`env`, `PATH`, `System`, `Runtime`), imports, any character outside the grammar |
| Timeout | mandatory `awap.script.timeout-ms` (default 10 000 ms) enforced through a virtual-thread future; timeout → `408` + `TIMEOUT` audit |
| Size limits | script ≤ 4 000 chars, context ≤ 32 KiB (`awap.script.max-context-chars`), output ≤ 8 192 chars (`awap.script.max-output-chars`) |
| Secrets | the script only receives the node's `ctx` JSON; environment variables and Spring beans are unreachable |
| Feature flag | `SCRIPT_NODE_ENABLED=false` by default; the node fails closed when the sandbox bean is absent |
| Audit | every execution writes an immutable `SCRIPT` audit row (script hash, outcome, error detail) |

## Audit storage

`V48__automation_audit.sql` creates `automation_audit_records` with RLS, a check constraint on the
kind/outcome and `REVOKE UPDATE, DELETE` for the runtime role, so an audited AI decision or script run
cannot be rewritten after the fact. Read it per tenant/instance via
`AutomationAuditRepository.findByTenantIdAndInstanceIdOrderByCreatedAtAsc`.

## Metrics

| Metric | Tags | Use |
|---|---|---|
| `awap.ai.requests` | `outcome` (`success`/`hitl`/`blocked`/`budget_exceeded`/`cache_hit`/`rate_limited`) | Guardrail blocks, budget and rate-limit pressure |
| `awap.ai.budget.utilization` | `state` (`near_limit`/`exhausted`) | Durable ledger warnings |
| `awap.ai.gateway.fallbacks` | `reason` | Provider fallback use |
| `awap.ai.tokens` / `awap.ai.cost.micros` | – | Spend tracking |
| `awap.script.executions` | `outcome` (`success`/`failed`/`timeout`) | Sandbox health |

## Whitelist-library requirement vs deny-by-construction decision (issue #298)

The plan's wording ("SCRIPT limited to whitelisted libraries") and the implementation (a
deny-by-construction expression grammar with no imports, libraries or method calls) are reconciled
in [ADR-0010](adr/0010-script-sandbox-deny-all-over-whitelist-libraries.md). The decision is to keep
the stronger deny-all sandbox as the default and fail closed; it is not weakened to accept a
library runtime. A future need for loops or libraries requires a separate worker-container/WASM
sandbox with its own ADR, resource limits and library allowlist.

### Security test matrix

`ScriptSandboxSecurityMatrixTest` enumerates every allowed construct and every denied construct:

| Allowed | Denied |
|---|---|
| Numbers, strings, booleans, `null` | Imports, classes, reflection, `Runtime`, `System`, process execution |
| `ctx.field` map reads (no calls, no indexing) | Method calls, `getClass`, indexing, assignment, loops, lambdas |
| `+ - * / %`, comparisons, `and`/`or`/`not`, parentheses, unary minus | Environment variables, system properties, Spring beans |
| `len`, `upper`, `lower`, `coalesce`, `abs` | URL/socket/HTTP/DNS/file-URL constructs, file and process access |
| String concatenation | Statement separators, collections, comments, unknown identifiers/functions |
| Bounded literal/expression sizes | Zero-width/unicode obfuscation and malformed input |

The same suite runs a deterministic 2 000-input fuzz loop (`Random(20261116L)`) and a deeply nested
bounded expression, proving arbitrary input either evaluates inside the grammar or raises
`ScriptSandboxException`; it never reaches host code.

`ScriptSandboxNetworkTest` (issue #306) adds explicit coverage for URL/HTTP/socket/DNS/file-URL/JDBC/
LDAP/SSRF payloads, host classes, reflection, imports and method calls. The context is validated
before parsing: only JSON primitives, maps and lists are accepted, so a callable or dynamic proxy is
rejected before the parser runs, and the result must also be a JSON primitive. A 1 000-input
network-focused fuzz loop and the timeout path prove there is no host-side effect.

## Threat-model notes

- **Prompt injection** — blocked before the provider; a bypass still cannot exceed the tenant's
  authority because tool calls require the caller's security context (AI rules in `CLAUDE.md`).
- **SCRIPT RCE** — the grammar cannot express host access; the residual risk is a parser bug, which
  is why the sandbox stays disabled by default and every execution is audited.
- **Resource exhaustion** — timeout + size caps; the executor is virtual-thread based, so a slow
  script cannot starve the workflow thread pool.
- **Secret exposure** — the context is an explicit JSON object; nothing else is in scope.
- **Supply chain** — there are no script imports/libraries to whitelist because the grammar forbids
  them; adding one would require a new ADR.

## Documentation review checklist

This document is audited with the same checklist as
[`ai-copilot.md`](ai-copilot.md#documentation-review-checklist): every capability row carries a
status and, for `Implemented`, a link to the test that proves it; every budget, rate-limit, cache,
fallback and routing claim names the control plane; and
`node scripts/check-capability-matrix.mjs` plus `node scripts/check-doc-links.mjs` must pass.

## Deferred

A full worker-container/WASM sandbox (for scripts needing loops or libraries) is intentionally out
of scope; the expression sandbox covers the documented use case and keeps the attack surface at a
parser. This is recorded in the PR and should be revisited with a new ADR before adding richer
scripting.

# Copilot LLM gateway: budget, rate limit, cache and fallback (issue #294)

Every Copilot model call now goes through `app/copilot/llm_gateway.py` instead of calling
`LlmClient` directly.

## Controls

| Control | Behaviour |
|---|---|
| Monthly tenant budget | Reserves `estimated_prompt_tokens + max_output_tokens` under a lock before the provider call. Over-budget raises `LlmBudgetExceeded` (HTTP 429) without a provider call. The reservation is settled to actual completion tokens on success and released on total failure. |
| Per-minute rate limit | Sliding 60-second window per tenant. Exceeding it raises `LlmRateLimited` (HTTP 429) with `Retry-After`. |
| Cache | Tenant + prompt hash + model + message key, LRU + TTL. A hit returns `provider="cache"`, zero token/cost usage and no provider call. |
| Fallback | Optional secondary client. Primary exceptions or empty content fall back and record the neutral reason (`RuntimeError`, `empty`, ...). If every provider fails, `LlmUnavailable` (HTTP 503) is raised; no answer is fabricated. |
| Usage ledger | Idempotent rows keyed by `(tenant, request_key, prompt_hash, model)`. A repeated request key returns the completed result without a second provider call. |

A failed usage write is fail-closed: the gateway raises `LlmUnavailable` rather than returning an
unaudited answer.

## Cost and token estimation

`estimate_tokens(text) = ceil(len(text) / 4)` (minimum 1). Admission reserves the prompt estimate
plus `AI_LLM_MAX_OUTPUT_TOKENS`; the usage row records actual prompt/completion estimates and
`cost_micros = tokens * AI_LLM_COST_MICROS_PER_TOKEN`.

## Response and audit

`CopilotResponse` gains `provider` and `fallback_reason` (also in the protobuf contract, fields 15
and 16). Chat tool calls carry `{provider, cached, fallbackReason}`. The immutable audit payload adds:

- `provider`, `fallbackReason`
- `llmTokens`, `llmCostMicros`
- `cacheHit`

## Errors

| Exception | HTTP | Retry-After |
|---|---|---|
| `LlmBudgetExceeded` | 429 | seconds to the first day of the next month |
| `LlmRateLimited` | 429 | seconds until the oldest request leaves the window |
| `LlmUnavailable` | 503 | 5 seconds (or 30 for a usage-store failure) |

The body carries `code` (`AI_BUDGET_EXCEEDED`, `AI_RATE_LIMITED`, `AI_UNAVAILABLE`) and a
user-facing `detail`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AI_LLM_MONTHLY_BUDGET_TOKENS` | `1000000` | Per-tenant monthly token budget; `0` disables. |
| `AI_LLM_RATE_LIMIT_PER_MINUTE` | `60` | Per-tenant per-minute calls; `0` disables. |
| `AI_LLM_CACHE_TTL_SECONDS` | `30` | LLM text cache TTL; `0` disables. |
| `AI_LLM_CACHE_MAX_ENTRIES` | `256` | Cache size cap. |
| `AI_LLM_COST_MICROS_PER_TOKEN` | `2` | Cost unit used in usage rows. |
| `AI_LLM_MAX_OUTPUT_TOKENS` | `1024` | Reservation headroom. |

## Multi-replica note

The default budget state and usage ledger are process-local. A multi-replica deployment must swap
`UsageStore` and the budget state for a shared, atomic store (PostgreSQL/Redis). The protocol is the
migration seam; until then, limits are per replica. This is recorded here so the behaviour is not
mistaken for a global quota.

## Tests

- `tests/test_llm_gateway.py`: exact tokens/cost, cache tenant/model scoping, budget rejection before
  the provider, rate-limit retry-after, fallback reasons, all-failed typed error with reservation
  release, idempotent request keys, fail-closed usage store, concurrent budget/rate admission,
  monthly reset, ledger idempotency/reconciliation, cache eviction.
- `tests/test_llm_gateway_api.py`: 429 budget, 429 rate limit with `Retry-After`, 503 outage.

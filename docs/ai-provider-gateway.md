# Multi-provider AI gateway (issue #292)

The backend no longer talks to one vendor directly. `AiProviderGateway` sits behind the existing
`AiBackendClient` seam and routes every AI call across a provider SPI.

## SPI

`AiProvider` (application layer) exposes:

| Method | Meaning |
|---|---|
| `id()` | Stable provider id (`openai`, `anthropic`, `local`). |
| `models()` | Normalized `AiModel` catalogue: model id, routing tier, capabilities, cost (micro-dollars per token) and latency budget (ms). |
| `healthy()` | Provider-reported availability. The gateway also owns a circuit breaker. |
| `complete(AiProviderRequest)` | Returns content or throws `AiProviderException`. |

`AiProviderException.Code` is vendor-neutral: `RATE_LIMITED`, `TIMEOUT`, `UNAVAILABLE`,
`AUTHENTICATION`, `INVALID_REQUEST`, `MALFORMED_RESPONSE`, `EMPTY_CONTENT`, `NO_PROVIDER`,
`ALL_PROVIDERS_FAILED`. A retryable flag is carried with the code; vendor status codes and payloads
never leave the adapter.

## Providers

| Provider | Wire format | Models | Notes |
|---|---|---|---|
| `OpenAiProvider` | OpenAI Chat Completions | configured model (default `gpt-4o-mini`) | `Authorization: Bearer`; all capabilities. |
| `AnthropicProvider` | Anthropic Messages | configured model (default `claude-3-5-haiku-latest`) | `x-api-key` + `anthropic-version: 2023-06-01`; all capabilities. |
| `LocalHeuristicProvider` | none | `local-heuristic` | Deterministic, free, last-resort fallback. |

Each external adapter maps 429 to `RATE_LIMITED`, 5xx to `UNAVAILABLE`, 401/403 to
`AUTHENTICATION`, other non-2xx to `INVALID_REQUEST`, malformed JSON to `MALFORMED_RESPONSE`,
blank content to `EMPTY_CONTENT`, timeouts to `TIMEOUT` and transport failures to `UNAVAILABLE`.

## Routing policy

Candidates are taken from the configured order (primary, fallback order, then any remaining
provider sorted by id) and filtered by:

1. **Capability** derived from the prompt (`summarize:`, `classify:`, `extract:`, otherwise text
   generation) and by the explicitly requested model.
2. **Cost budget** (`awap.ai.gateway.max-cost-micros-per-token`); `0` disables the budget.
3. **Health** and the per-provider **circuit breaker**.
4. **Latency** — a provider whose observed latency exceeds its model's budget is skipped when
   another candidate remains; if it is the only candidate it is still used rather than failing.

The gateway tries candidates in order. Any provider error triggers the next candidate. When every
candidate fails it throws `ALL_PROVIDERS_FAILED` with the attempted provider/code pairs; it never
fabricates an answer.

## Circuit breaker

`CircuitBreaker` opens after `failure-threshold` consecutive failures and stays open for
`open-ms`; the next call after the window is a half-open probe. A success closes the breaker and
resets the failure count. Tests use a mutable clock, so open/recovery is deterministic.

## Audit and metrics

Every attempt emits a structured audit line:

```
ai.provider.call provider=openai model=gpt-4o-mini capability=CLASSIFICATION outcome=RATE_LIMITED fallback=anthropic
```

The successful line records `fallback=<first failed provider:code>` (or `NONE`).

Micrometer meters:

| Meter | Tags |
|---|---|
| `awap.ai.gateway.requests` | `provider`, `model`, `capability`, `outcome` |
| `awap.ai.gateway.duration` | `provider`, `outcome` |
| `awap.ai.gateway.fallbacks` | `from`, `to`, `reason` |

## Configuration and secrets

| Property | Default | Meaning |
|---|---|---|
| `awap.ai.gateway.enabled` | `false` | Enables the gateway and its `@Primary` bean. |
| `awap.ai.gateway.primary` | `local` | First candidate. |
| `awap.ai.gateway.fallback-order` | `openai,anthropic,local` | Comma-separated fallback chain. |
| `awap.ai.gateway.max-cost-micros-per-token` | `0` | Per-token cost ceiling; `0` disables. |
| `awap.ai.gateway.circuit.failure-threshold` | `3` | Consecutive failures before opening. |
| `awap.ai.gateway.circuit.open-ms` | `30000` | Open window. |
| `awap.ai.providers.openai.enabled` | `false` | Registers the OpenAI adapter. |
| `awap.ai.providers.openai.api-key` | empty | Required when enabled; startup fails fast when blank. |
| `awap.ai.providers.anthropic.enabled` | `false` | Registers the Anthropic adapter. |
| `awap.ai.providers.anthropic.api-key` | empty | Required when enabled; startup fails fast when blank. |

Keys are deployment-scoped and come from the environment/secret manager. Tenant input never selects
or supplies a provider key, so a tenant cannot read another tenant's credential. Error messages
never echo a key; the tests assert the secret is absent from startup failures.

When the gateway is enabled the legacy single-provider `OpenAiCompatibleAiBackend` is not
registered, so there is exactly one `@Primary AiBackendClient`.

## Onboarding a provider

1. Implement `AiProvider` (or extend `AbstractHttpAiProvider`) in `com.awap.ai.infrastructure`.
2. Declare the model catalogue with tier, capabilities, cost and latency budget.
3. Map every vendor response to the neutral error codes.
4. Add contract tests for success, 429, 5xx, 401, malformed, empty, timeout and transport failure.
5. Register it with a `@ConditionalOnProperty` flag and add it to the fallback order.
6. Update this document and the gateway tests that assert routing order.

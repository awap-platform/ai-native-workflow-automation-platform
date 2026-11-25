# AI response latency and async Copilot jobs (issue #290)

AI latency is a separate SLO from the platform HTTP P95. A slow model provider must never be
mistaken for a slow workflow API, and a long-running Copilot request must not hold an HTTP
connection open while it waits for the provider.

## Latency metrics

The backend emits Micrometer timers; Prometheus scrapes them from `/actuator/prometheus`.

| Timer | Prometheus name | Tags |
|---|---|---|
| AI request | `awap_ai_request_duration_seconds` | `tier`, `action`, `outcome`, `cache`, `tenant` |
| Provider call | `awap_ai_provider_duration_seconds` | `model`, `result` |
| Async job queue wait | `awap_ai_job_queue_wait_seconds` | none (single bounded queue) |

- `tier` is the routing decision (`cheap`, `standard`, `complex`, `none`).
- `action` is the Copilot action (`chat`, `async_job`, ...). It is derived from the forwarded path,
  never from caller input.
- `outcome` is `SUCCESS`, `HITL`, `CACHE_HIT`, `TIMEOUT` or `ERROR`.
- `cache` is `hit` or `miss`. A cache hit is recorded as a `CACHE_HIT` success with low latency.
- `tenant` is a **bucket** (`t0`..`t9`) derived from the tenant UUID. The raw tenant id is never a
  metric label, so tenant cardinality cannot explode the series count.
- Timers publish a percentile histogram, so `histogram_quantile()` works without client-side
  percentile configuration.

The AI layer additionally exposes per-instance JSON percentiles on
`GET /api/v1/copilot/metrics` (`latencies`), which is useful for local debugging and for the async
job path. Prometheus remains the production source of truth.

## Alerts and dashboards

`infra/prometheus/alert-rules.yml` (`awap-ai` group):

- `AwapAiLatencyHigh` — AI p95 above 5s for 10 minutes.
- `AwapAiErrorRateHigh` — `ERROR`/`TIMEOUT` ratio above 10% for 10 minutes.
- `AwapAiJobQueueWaitHigh` — async job queue wait p95 above 5s for 10 minutes.

The Grafana dashboard adds three panels: AI request latency p50/p95/p99, AI error ratio and async
Copilot job queue wait p95. Runbook section O34 covers the response.

## Sync vs async

Use the synchronous endpoints for short, interactive actions where the user is waiting:

- `chat`, workflow discovery, task queries, approval assistance, knowledge search.

Use the async job endpoints when the work may exceed the synchronous budget (default 10s backend
timeout) or when the caller can poll:

- long document analysis, multi-step extraction or any action expected to exceed ~5 seconds.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/copilot/jobs` | Submit work; returns `202` with a job handle. |
| `GET /api/v1/copilot/jobs/{jobId}` | Poll state and result. |
| `POST /api/v1/copilot/jobs/{jobId}/cancel` | Cancel a queued or running job. |

The SPA talks to the backend proxy (`/api/v1/copilot/jobs...`); the AI layer is never exposed
directly.

## Job state model

```
QUEUED -> RUNNING -> SUCCEEDED
                  -> FAILED
QUEUED -> CANCELLED
RUNNING -> CANCELLED (best effort)
```

- **Tenant/user scoping:** `GET` and `cancel` only return the caller's own job. Another tenant's or
  another user's job is indistinguishable from a missing one (`404`).
- **Idempotency:** `Idempotency-Key` (also accepted in the JSON body) is scoped to the tenant. A
  duplicate submission returns the original job instead of creating duplicate work.
- **Retention:** jobs live in a bounded in-memory store with a TTL (`AI_JOB_TTL_SECONDS`, default
  3600) and a capacity limit (`AI_JOB_MAX_JOBS`, default 1000). Expired jobs are pruned on submit
  and on demand; a pruned job returns `404`.
- **Queue overflow:** a full queue returns `429` so the caller can retry or use the sync path.
- **Staleness:** the job response carries `prompt_version` and `prompt_hash`, so a result can be
  tied to the exact prompt version that produced it.
- **Cancellation:** cancelling stops polling and marks the job `CANCELLED`. Cancelling a provider
  call is best effort; the provider timeout remains the hard bound, and a late answer never
  overwrites the cancelled state.

## Read-only response cache

Explicit `chat` requests with no context, no idempotency key and no high-risk confirmation are
cached for `AI_RESPONSE_CACHE_TTL_SECONDS` (default 30, set `0` to disable). The cache is bounded
(256 entries, LRU + TTL) and keyed by tenant, user, prompt key/hash and message. A hit re-runs no
tool and is recorded as `cache_hit=true` with `outcome=CACHE_HIT`. State-changing actions are never
cached.

## SLO isolation proof

`load-test/lib/ai-latency-isolation.mjs` evaluates a baseline platform summary, a summary with slow
AI traffic, and the AI summary. It fails unless:

- platform p95 ≤ 2s, p99 ≤ 4s and error rate ≤ 1%,
- platform p95 moves by ≤ 500ms versus the no-AI baseline,
- AI p95 is present and ≤ 5s (the separate AI budget).

Run its checks with:

```bash
node --test "load-test/test/*.test.mjs"
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AI_JOB_MAX_JOBS` | `1000` | Maximum retained jobs before `429`. |
| `AI_JOB_TTL_SECONDS` | `3600` | Retention window for completed/abandoned jobs. |
| `AI_RESPONSE_CACHE_TTL_SECONDS` | `30` | Read-only answer cache TTL; `0` disables. |
| `awap.ai.copilot.timeout-ms` (backend) | `10000` | Hard bound for synchronous Copilot calls. |

## Streamed answers and true time-to-first-token (issue #374)

`POST /api/v1/copilot/chat/stream` emits the answer as versioned SSE frames (`v`, `type`, `seq`).
The client records `firstTokenMs` when the first `token` frame arrives, not when an animation tick
fires, so the latency signal now reflects transport plus provider time instead of a fixed reveal
delay. `seq` is monotonic; an out-of-order frame is ignored rather than reordered, and the final
`done` frame carries the same payload as the buffered `/chat` response so accounting and audit stay
identical on both paths. A mid-stream `error` frame ends the turn as incomplete — the client never
treats partial text as a success — and a client disconnect closes the upstream body, which aborts the
provider request.

# Operational log analysis (issue #286)

Backend and AI-layer logs are structured JSON and can be correlated end to end. The backend ships
the same document to OpenSearch through a bounded asynchronous queue; the console JSON appender
remains the always-available local path.

## Log document schema

| Field | Type | Source | Notes |
|---|---|---|---|
| `tenantId` | keyword | `X-Tenant-Id` MDC field | Required. Events without a tenant are never indexed. |
| `service` | keyword | `spring.application.name` / AI-layer constant | Distinguishes backend from AI-layer rows. |
| `level` | keyword | logger level | `INFO`, `WARN`, `ERROR`, … |
| `logger` | keyword | logger name | Stable component identifier. |
| `message` | text | formatted message | Redacted before indexing. |
| `correlationId` | keyword | `X-Correlation-Id` MDC field | Required correlation key across services. |
| `traceId` | keyword | Micrometer tracing / `X-Trace-Id` | Optional distributed-trace key. |
| `timestamp` | date | log event time | UTC, `strict_date_optional_time`. |

Unknown fields are never indexed: the OpenSearch template uses `dynamic: strict`, and
`LogRedactor` copies only the fields above. The message is passed through
`AnalyticsPiiRedactor.redactText`, which masks e-mail addresses, phone numbers and SSNs.

## Index template and retention

- Daily index name: `awap-logs-YYYY.MM.DD`.
- Template: `awap-logs-template` (`dynamic: strict`, one shard, one replica).
- ISM policy: `awap-logs-ism`, hot for `awap.logs.retention-hot-days` (default 7), deleted at
  `awap.logs.retention-delete-days` (default 90).
- Dead-letter index: `awap-logs-dlq-YYYY.MM.DD`.

`LogOpenSearchProvisioner` applies the template and policy with idempotent `PUT` calls on startup;
a `409` means another instance already provisioned the identical resource.

## Shipping and outage behaviour

- `LogbackOpenSearchAppender` forwards every tenant-scoped event to `OpenSearchLogShipper`.
- The shipper uses a bounded queue (`awap.logs.queue-capacity`, default 1000). When it is full the
  oldest event is dropped and `awap.logs.shipped{outcome="dropped"}` increments.
- A scheduled drain sends batches (`awap.logs.batch-size`, default 100), retries `429`/`5xx` and I/O
  failures up to `awap.logs.max-attempts`, then writes the envelope to the daily DLQ index.
- If the OpenSearch transport is unavailable, the batch is dropped with a metric and the
  application stays healthy; log shipping never blocks request threads.

Enable the path with `awap.logs.opensearch.enabled=true`. It reuses the analytics
`OpenSearchTransport`, so the analytics OpenSearch endpoint must also be configured.

## Search API

`GET /api/v1/logs/search?correlationId=…&from=…&to=…&limit=…`

- Requires `INSTANCE_READ` and a valid tenant context.
- The `tenantId` filter is always added from the authenticated session and can never be supplied by
  the caller.
- The window defaults to the last 24 hours and is capped at 30 days; `limit` is 1–200.
- Messages are redacted again before they are returned.
- An OpenSearch outage returns `503` with an explicit "temporarily unavailable" problem detail, not
  an empty result.

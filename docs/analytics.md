# Advanced analytics aggregations (issue #285)

The dashboard is served by `GET /api/v1/analytics/dashboard`. Every request is tenant-scoped by
the authenticated session (`INSTANCE_READ`), interpreted in UTC, and bounded to 366 days.

## Sources of truth

| Data | Source | Why |
|---|---|---|
| Daily totals, event counts and average durations | PostgreSQL `analytics_aggregates` | Authoritative, transactional and cheap to read. |
| Duration percentiles, task cycle time, approval latency, node bottlenecks, trend windows | PostgreSQL `analytics_event_samples` (bounded raw-event samples) | Exact percentiles cannot be reconstructed from daily sums. |
| High-volume raw-event exploration | OpenSearch analytics index | Optional best-effort mirror; the dashboard never invents values when it is unavailable. |

`dataCompleteness` reports which sources answered. When `rawEventsAvailable` is `false`, the API and
the dashboard render an explicit partial state; daily totals remain authoritative.

## Query contract

| Parameter | Values | Default | Bound |
|---|---|---|---|
| `from` | ISO date (UTC) | `to - 6 days` | inclusive |
| `to` | ISO date (UTC) | today | inclusive |
| `granularity` | `DAY`, `WEEK`, `MONTH` | `DAY` | WEEK starts on ISO Monday, MONTH on day 1 |
| `groupBy` | `EVENT_TYPE`, `NODE`, `WORKFLOW` | `EVENT_TYPE` | `WORKFLOW` groups by instance ID |
| `limit` | integer | `10` | 1–50 |

Invalid dates, an inverted range, a range over 366 days, an unknown granularity/group-by or an
out-of-range limit return `400`. A missing authentication context returns `401`; a caller without
`INSTANCE_READ` returns `403`.

## Metrics and dimensions

| Metric | Definition | Dimensions |
|---|---|---|
| `dailyTotals` | Tenant/day/event-type count, total duration and average duration | day, event type |
| `timeBuckets` | Daily totals rolled up to DAY/WEEK/MONTH | bucket, event type |
| `workflowDuration` | Nearest-rank p50/p90/p95/p99 of `WORKFLOW_COMPLETED` durations | tenant, window |
| `taskCycleTime` | Nearest-rank percentiles of `TASK_COMPLETED` durations | tenant, window |
| `approvalLatency` | Nearest-rank percentiles of `APPROVAL_COMPLETED` durations | tenant, window |
| `failureRate` | `WORKFLOW_FAILED / (WORKFLOW_COMPLETED + WORKFLOW_FAILED)` | tenant, window |
| `slaBreachRate` | `SLA_BREACHED / all events` | tenant, window |
| `bottlenecks` | Nodes ranked by average duration, then node ID | node |
| `groups` | Count, average and p95 for the selected `groupBy` | event type, node or workflow instance |
| `trend` | Current-window sample count vs the equally sized preceding window | tenant |

Percentiles use nearest rank: `index = ceil(p / 100 * n) - 1`, clamped to the sorted sample list.
An empty sample set returns `null` percentiles and `sampleCount = 0`, never a fabricated zero.

## Performance and isolation

- The query is read-only with a five-second transaction timeout.
- The date range is capped at 366 days and every ranking is capped by `limit`.
- Repository queries always include `tenant_id`; PostgreSQL row-level security enforces the same
  boundary with `FORCE ROW LEVEL SECURITY`.
- Raw-event samples contain identifiers and durations only, never free-form payloads or PII.

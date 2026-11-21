# Real-user monitoring (RUM)

**Status:** wiring implemented and unit-tested; no RUM dashboard or alert
consumes the produced events yet. This page is the integration contract.

## Flow

```text
browser (useReportWebVitals)
  -> createVitalSender            (flag-gated, redacted, same-origin)
  -> POST /api/rum                (validated, 204)
  -> structured log line          `rum-vital {json}`
  -> log pipeline                 Loki / CloudWatch / OTel log exporter
  -> Prometheus / Grafana / hosted RUM backend   (integration point)
```

The browser never loads a third-party script. The ingest route is same-origin,
so the nonce CSP only needs `connect-src 'self'`.

## Feature flag

| Flag | Env var | Default | Owner | Expires |
|---|---|---|---|---|
| `rum_vitals` | `FEATURE_RUM` | off | site-reliability | 2027-03-31 |

When the flag is off, `createVitalSender` does not send and the route returns 204
and drops the payload. Staging and prod overlays set `FEATURE_RUM=true`; dev
keeps it `false`.

## Payload

```json
{
  "schemaVersion": 1,
  "metric": {
    "id": "v3-1234",
    "name": "LCP",
    "value": 1840,
    "rating": "good",
    "delta": 12,
    "navigationType": "navigate"
  },
  "route": "/instances/:id",
  "release": "1.7.0",
  "recordedAt": "2026-11-21T10:00:00.000Z"
}
```

Redaction happens before sending: query strings and fragments are removed,
numeric and UUID path segments become `:n`/`:id`, and the route must start with
`/`. The ingest route re-validates the envelope and rejects anything else with
400.

## Budgets

The same thresholds as Lighthouse and the canary policy:

| Metric | Budget | Alert |
|---|---:|---|
| LCP | < 2500 ms | Release guard (canary latency / Web Vitals regression) |
| CLS | < 0.1 | Release guard |
| TBT | < 200 ms | Release guard |
| INP | ≤ 200 ms | Release guard target |
| Error rate | ≤ 1% | `AwapReleaseCanaryFailureRate` |
| p95 latency | ≤ 1.5 s | `AwapReleaseCanaryLatencyP95` |
| DLQ growth | = 0 | `AwapReleaseCanaryDlqGrowth` |

## Integration steps (not executed)

1. Enable the log-based metric on the `rum-vital` line in the log pipeline.
2. Export the metric as `awap_web_vital_seconds{metric="LCP|CLS|TBT|INP"}`.
3. Add the metric to `infra/grafana/metric-catalog.json` and a dashboard panel;
   the dashboard test fails until the metric is catalogued.
4. Add a RUM-specific alert if the release-guard alerts are not sufficient.

Until step 1–3 are done, RUM data is visible only in structured logs and no
claim about live user percentiles is made.

## Privacy and limits

- No user id, tenant id, task id, search term or full URL is sent.
- `navigator.sendBeacon` is preferred (survives unload); `fetch(..., {keepalive})`
  is the fallback.
- Reporting failures are swallowed; they never affect the page.
- Sampling, retention and the external collector (`RUM_COLLECTOR_URL`) are
  deployment configuration, not code.

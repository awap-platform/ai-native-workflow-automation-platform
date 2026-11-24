# Canary and rollback drill — 2026-11-24

**Issue:** #367
**Environment:** controlled local HTTP canary harness (two real deployments,
percentage router, stable and canary backends)
**Policy:** [`../canary-policy.json`](../../../infra/release/canary-policy.json)
**Machine-readable evidence:** [`canary-drill.json`](canary-drill.json)
**Reproduce:** `node scripts/canary/drill.mjs`
**Gate:** `node scripts/check-canary-evidence.mjs`

## Result

| Check | Observed | Result |
|---|---|---|
| T1 5% canary | 120 requests, 0 errors, p95 10.3 ms | PASS |
| T2 25% promotion | 120 requests, 0 errors, p95 11.2 ms | PASS |
| T3 100% promotion | 120 requests, 0 errors, p95 6.8 ms | PASS |
| T4 rollback | previous stable deployment served 100% | PASS |
| T5 RTO | 0.054 s (limit 1800 s) | PASS |
| T6 alert | fired and routed to on-call; fallback delivered | PASS |
| T7 correlation | request and response correlation ids matched | PASS |
| T8 tenant isolation | 0 cross-tenant responses | PASS |
| T9 migration | forward and backward safe (expand/contract) | PASS |
| T10 feature-flag kill | stable deployment served all post-kill requests | PASS |

## Unhappy paths

| ID | Scenario | Observed | Result |
|---|---|---|---|
| U1 | 5xx spike | auto rollback in 0.054 s (< 300 s) | PASS |
| U2 | latency spike | promotion aborted at p95 2003 ms > 1500 ms | PASS |
| U3 | alert delivery failure | fallback channel delivered | PASS |
| U4 | rollback runbook | operations runbook section present | PASS |
| U5 | migration failure | rollback plan uses the previous image | PASS |
| U6 | partial tenant failure | tenant A 0 errors, tenant B isolated | PASS |

## What this proves and what it does not

It proves the policy math, stage promotion, automatic detection, rollback
behaviour, RTO, alert routing, correlation, tenant isolation and the kill
switch against real HTTP traffic between two deployments.

It does **not** prove the production ingress, Argo Rollouts/service weights or a
real user cohort. The production canary is deferred with the following
risk acceptance, recorded in the JSON evidence:

- **Owner:** release-engineering
- **Reason:** the production canary and live rollback require a service window
  and real traffic; this drill is the executable staging evidence.

The release ticket must schedule the production window and attach the live
dashboard, alert and timestamp evidence before GA.

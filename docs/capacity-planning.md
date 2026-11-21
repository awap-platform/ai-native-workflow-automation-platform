# Capacity planning

Issue #187 makes the HPA effective: every workload now declares CPU/memory
requests and limits, the HPA has scale-up/down behavior, and disruptions are
bounded by PodDisruptionBudgets and topology spread.

## Resource budget

| Workload | CPU request | CPU limit | Memory request | Memory limit |
|---|---:|---:|---:|---:|
| backend | 250m | 1 | 512Mi | 1Gi |
| frontend | 100m | 500m | 256Mi | 512Mi |
| ai-layer | 200m | 1 | 512Mi | 1Gi |

Requests are the HPA denominator: a CPU utilization target of 70% is 70% of
the request, not of the node. Limits leave headroom for bursts while keeping
OOM kills and throttling observable.

## HPA

| Environment | Backend | Frontend | AI layer |
|---|---|---|---|
| dev | 1–3 | 1–3 | 1–2 |
| staging | 2–6 | 2–4 | 1–3 |
| prod | 3–12 | 3–8 | 2–6 |

Behavior (all environments, defined in `infra/k8s/base/hpa.yaml`):

- scale up: 30s stabilization, at most +100% or +2 pods per 30s;
- scale down: 300s stabilization, at most -50% per 60s.

The longer scale-down window prevents thrashing after a short traffic spike.

## Disruption budget and spread

- `awap-backend-pdb`, `awap-frontend-pdb`, `awap-ai-layer-pdb` keep
  `minAvailable: 1` (prod: `2` for backend/frontend/AI).
- Every Deployment has a `topologySpreadConstraints` with `maxSkew: 1` on
  `topology.kubernetes.io/zone` and `ScheduleAnyway`, so replicas spread across
  zones when possible without blocking scheduling during a zone shortage.

## Prerequisites

The HPA requires metrics-server. The CI kind job installs it and then runs:

```bash
node infra/k8s/scripts/validate-overlays.mjs --metrics
```

A cluster without metrics-server reports `FAIL: metrics-server is not available`
instead of silently keeping the HPA at its minimum.

## Proving scale-out and scale-in

```bash
# Static proof: every HPA has a CPU target and scale behavior.
node load-test/hpa-scale.mjs --dry-run

# Cluster proof (needs metrics-server and the dev overlay applied):
node load-test/hpa-scale.mjs --cluster --namespace awap-dev
```

The cluster run creates a busybox load pod against `awap-backend`, polls the HPA
until the replica count rises, deletes the load, and polls until it returns to
the minimum. The node:test suite covers the replica math, direction, validation
and the polling/cleanup paths with a fake kubectl.

## Review cadence

- Monthly: compare requests/limits with real usage and VPA recommendations.
- Quarterly: revisit HPA bounds with load-test results and traffic forecasts.
- After every incident: check whether throttling, OOMKilled or PDB disruptions
  contributed, and adjust the budget through this document.

## Phase 10 performance budgets

The release-readiness phase adds client-side ceilings that the HPA does not
cover:

| Signal | Budget | Where enforced |
|---|---:|---|
| Route JavaScript (gzip) | ≤ 250 KB | `pnpm budget` |
| Lighthouse performance | ≥ 90 | `.github/lighthouse/lighthouserc.json` |
| LCP | < 2.5 s | Lighthouse + canary policy |
| CLS | < 0.1 | Lighthouse + canary policy |
| TBT | < 200 ms | Lighthouse + canary policy |
| INP | ≤ 200 ms | Lighthouse warning + canary policy |

RUM adds no third-party request and no server-side compute beyond one log line
per sample; the ingest route is flag-gated and returns 204. When the flag is
enabled in staging/prod, the additional log volume is a few hundred bytes per
navigation and is accounted for by the frontend replica budget (256 MiB
request / 512 MiB limit).

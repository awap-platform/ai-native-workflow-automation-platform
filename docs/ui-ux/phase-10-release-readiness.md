# Phase 10 — Accessibility, performance and release readiness

**Status:** implemented on `feat/phase-10-release-readiness`
**Owner:** Frontend platform / Site reliability
**Related:** [`../accessibility.md`](../accessibility.md), [`../release-runbook.md`](../release-runbook.md),
[`../operations-runbook.md`](../operations-runbook.md), [`../uat-plan.md`](../uat-plan.md),
[`../observability-rum.md`](../observability-rum.md), [`../e2e-deploy-dod.md`](../e2e-deploy-dod.md),
[`programme-completion.md`](programme-completion.md)

## Goal

Close the programme with evidence rather than intent: every route is accessibility-
and keyboard-checked, the layout is verified from 320 px to 1920 px, performance
budgets are enforced in CI, real-user monitoring has a wired ingest point, every
feature flag has an owner and an expiry, the canary/rollback policy is
machine-readable and validated, and the degraded modes (no JavaScript, slow 3G,
older browser, high contrast, CDN failure) have visible behaviour.

This document separates **implemented and executed** items from **process steps
that require people or a live environment**. Nothing here claims a manual pass,
a live canary or a UAT session that has not happened.

## Workstreams and evidence

| # | Workstream | Implementation | Automated proof |
|---|---|---|---|
| 1 | axe on every route | [`accessibility.spec.ts`](../../frontend/e2e/accessibility.spec.ts) scans every screen and state with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`; only `critical`/`serious` impact fails; the full report is written to `a11y-report/report.json` | E2E job, artifact `a11y-report` |
| 2 | Forced-colors accessibility | Same spec scans login, register, dashboard, tasks and Copilot with `forcedColors: active`; `color-contrast` is disabled there because the OS owns the palette | E2E |
| 3 | Keyboard-only journeys | Skip-link focus, visible `:focus-visible`, Tab-to-sidebar + Enter navigation, Escape-closes-drawer focus return, Ctrl/⌘+K palette, `J`/`K`/`Enter`/`A`/`R` inbox shortcuts | E2E (`accessibility.spec.ts`, `shell.spec.ts`, `task-inbox.spec.ts`) |
| 4 | Structural screen-reader guarantees | One `h1`, one `main` landmark and a navigation landmark on every screen; `aria-live` regions on documents, notifications, task detail and Copilot | E2E |
| 5 | Responsive matrix | Every screen at 320, 360, 390, 768, 1024, 1440 and 1920 px with no document-level horizontal scroll | [`responsive.spec.ts`](../../frontend/e2e/responsive.spec.ts) |
| 6 | 200% zoom | 640 px equivalent for 12 reflow-critical screens, no horizontal scroll | E2E |
| 7 | Reduced motion | Every transition and animation collapses to ≤ 0.01 s on 12 screens | E2E |
| 8 | Visual regression | 16 screens × 4 viewports plus a core matrix (6 routes × 2 states × 4 widths, 320/768/1280/1920) = 112 committed snapshots | [`visual-baseline.spec.ts`](../../frontend/e2e/visual-baseline.spec.ts) |
| 9 | Lighthouse budgets | Performance ≥ 90, accessibility ≥ 90, best practices ≥ 90, LCP < 2.5 s, CLS < 0.1, TBT < 200 ms, zero console errors, INP ≤ 200 ms (warning) | [`.github/lighthouse/lighthouserc.json`](../../.github/lighthouse/lighthouserc.json) |
| 10 | Real-user monitoring | [`monitoring.ts`](../../frontend/lib/monitoring.ts) + [`WebVitalsReporter.tsx`](../../frontend/components/providers/WebVitalsReporter.tsx) + [`app/api/rum/route.ts`](../../frontend/app/api/rum/route.ts), gated by the `rum_vitals` flag | Jest + documented integration point |
| 11 | Feature flags | [`featureFlags.ts`](../../frontend/lib/featureFlags.ts) registry with owner, expiry, default and stage; server evaluation from the Kubernetes ConfigMap; client snapshot through [`featureFlagContext.tsx`](../../frontend/lib/featureFlagContext.tsx) | Jest + `check-release-policy.mjs` |
| 12 | Canary and rollback | [`canary-policy.json`](../../infra/release/canary-policy.json), [`releaseReadiness.ts`](../../frontend/lib/releaseReadiness.ts), release-guard alerts in [`alert-rules.yml`](../../infra/prometheus/alert-rules.yml) | Jest + `check-release-policy.mjs` + Prometheus rule tests |
| 13 | Fallbacks | `<noscript>` in the root layout, [`FallbackNotices.tsx`](../../frontend/components/layout/FallbackNotices.tsx) for slow 3G, unsupported browser and failed static assets, forced-colors CSS | E2E + Jest (`browserSupport.test.ts`) |
| 14 | Training note | [`InAppTour.tsx`](../../frontend/components/layout/InAppTour.tsx), dismissible, `localStorage`-backed | Jest + E2E |

## Accessibility

Every screen in the shared matrix is scanned in its empty and populated state
(45 axe runs) plus a keyboard-focus walk per screen. The phase-10 additions are:

- a structural assertion per route (single `h1`, `main`, navigation landmark);
- a skip-link test (first keyboard stop, `href="#main-content"`);
- five forced-colors axe scans;
- a keyboard-only dashboard journey (Tab to the sidebar, Enter navigates);
- high-contrast visible borders (`.awap-button` keeps a border under
  `forced-colors: active`).

### Screen-reader procedures (manual, not executed in this PR)

CI has no screen reader, so NVDA and VoiceOver passes stay manual. The exact
procedures are documented here so a reviewer can repeat them; the automated
landmark/name/live-region checks above are the regression net.

**NVDA + Firefox or Chrome (Windows)**

1. Start NVDA (`Ctrl+Alt+N`), then open the application.
2. `H` cycles headings: confirm one level-1 heading, and that each page's
   sections are reachable in order.
3. `D` cycles landmarks: confirm the banner, navigation and main landmarks are
   announced once each.
4. `Tab` through the sign-in page: every field announces its label, errors are
   announced through the live region, and the skip link appears first.
5. Open the task inbox, press `J`/`K`: the row cursor change is announced; `A`
   and `R` announce the confirmation dialogs.
6. Open Documents and Notifications: confirm the scan-status and unread live
   regions announce changes without focus moving.
7. Open Copilot: confirm the transcript region announces streaming answers and
   that citations are reachable.

**VoiceOver + Safari (macOS and iOS)**

1. Enable VoiceOver (`Cmd+F5`), use `VO+U` to open the rotor.
2. Landmarks rotor: banner, navigation and main are listed once per page.
3. Headings rotor: exactly one level-1 heading per route.
4. Forms rotor: every input has a label and the error summary is announced.
5. On iOS, swipe through the task inbox; confirm the row cursor and buttons
   have distinct labels and that the tour can be dismissed with a double-tap.

Record the date, browser, screen-reader version and any defect in the release
ticket. A failed step blocks the release until triaged.

## Responsive and motion

`responsive.spec.ts` sets each width and opens every screen, asserting
`documentElement.scrollWidth <= clientWidth + 1`. Two real defects were found
and fixed in this phase:

- the two single-sign-on buttons on the sign-in page forced a 419 px minimum
  width; they now stack below the `sm` breakpoint;
- the designer's fixed 15 rem palette and 20 rem side panels scrolled the
  document at 320–390 px; they now stack below 1024 px.

The 200% zoom equivalent (640 px) is checked on the auth screens, dashboard,
tasks, workflows, documents, notifications, analytics, admin and Copilot.
`prefers-reduced-motion: reduce` is verified on the same screens.

## Performance and RUM

Lighthouse runs on the production stack in the `End-to-End Tests` job against
the public entry screens. The budgets are hard errors except INP and FCP, which
are warnings because they are sampled from a single run; the policy is
`CLS < 0.1`, `TBT < 200 ms`, `LCP < 2.5 s`, performance ≥ 90. For a release
decision, run Lighthouse three times locally and compare the median (the CI run
uses one sample to stay inside the job budget).

Real-user monitoring is implemented but opt-in:

| Piece | Behaviour |
|---|---|
| `WebVitalsReporter` | Calls `useReportWebVitals` and forwards LCP/CLS/TBT/INP samples |
| `createVitalSender` | Drops everything unless the `rum_vitals` flag is on; redacts query strings, fragments, numeric ids and UUIDs |
| `POST /api/rum` | Validates the envelope, logs one structured `rum-vital` line, optionally forwards to `RUM_COLLECTOR_URL`, returns 204; malformed bodies return 400 |
| Integration point | The log pipeline (Loki/CloudWatch/OTel log exporter) indexes the line; Prometheus/Grafana or a hosted RUM backend consumes it. No third-party script is loaded. |

Enabling RUM is a ConfigMap change (`FEATURE_RUM=true` in staging/prod), not a
code change. See [`../observability-rum.md`](../observability-rum.md).

## Feature flags

| Flag | Env var | Owner | Expires | Default | Stage |
|---|---|---|---|---|---|
| `ai_copilot` | `FEATURE_AI_COPILOT` | frontend-platform | 2027-06-30 | on | ga |
| `analytics_console` | `FEATURE_ANALYTICS_CONSOLE` | frontend-platform | 2027-06-30 | on | ga |
| `in_app_tour` | `FEATURE_IN_APP_TOUR` | design-experience | 2027-03-31 | on | canary |
| `rum_vitals` | `FEATURE_RUM` | site-reliability | 2027-03-31 | off | internal |

Evaluation rules: an expired flag is **always off** (fail-closed) even if the
environment enables it; otherwise an explicit `1/true/on/yes` or
`0/false/off/no` wins over the default; an unrecognised value falls back to the
default. `staleFeatureFlags()` and `scripts/check-release-policy.mjs` fail the
build once a flag passes its expiry, so removing a flag is the only way to keep
the pipeline green. All three overlays expose the phase-10 flags; the frontend
reads them at request time from the ConfigMap, never from a build-time
`NEXT_PUBLIC_*` variable.

## Canary and rollback

[`canary-policy.json`](../../infra/release/canary-policy.json) is validated by
both the Jest suite and the Node gate:

| Stage | Traffic | Gate |
|---|---:|---|
| 1 | 5% | clean 30-minute observation window |
| 2 | 25% | clean 30-minute observation window |
| 3 | 100% | clean 30-minute observation window |

Automatic rollback thresholds: error rate ≤ 1%, p95 latency ≤ 1.5 s,
LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, INP ≤ 200 ms. The thresholds may tighten
but never loosen the global budgets. Three Prometheus alerts implement the
policy: `AwapReleaseCanaryFailureRate`, `AwapReleaseCanaryLatencyP95` and
`AwapReleaseCanaryDlqGrowth`; each links to the rollback section of the
operations runbook.

What is **not** executed here: no traffic was shifted, no canary was observed and
no rollback was triggered in a live cluster. The runbook and the drill script
define the procedure; see [`../release-runbook.md`](../release-runbook.md).

## UAT and training

The 10-task UAT plan with a ≥ 90% success threshold is in
[`../uat-plan.md`](../uat-plan.md). The in-app tour on `/dashboard` is the
training note: four steps, the Ctrl/⌘+K hint, and a dismiss action that persists
in `localStorage`. It is gated by `in_app_tour`. The UAT sessions themselves have
not been run; the plan records exactly what evidence to attach.

## Fallbacks

| Condition | Behaviour |
|---|---|
| JavaScript disabled | Server-rendered `<noscript>` notice in the root layout explains the requirement and points to `COMPATIBILITY.md`; asserted by a JavaScript-disabled Playwright context |
| Slow 2G/3G or data-saver | `FallbackNotices` shows a status banner explaining that skeletons stay visible until data arrives; asserted with an injected `navigator.connection` |
| Older browser | Capability detection (`Promise`, `fetch`, `Intl`, `IntersectionObserver`) shows a warning naming the missing API; asserted by removing `IntersectionObserver` |
| High contrast | `forced-colors` CSS keeps control borders and the current-page outline; axe scans run in that mode |
| CDN/static-asset failure | A capture-phase `error` listener on `SCRIPT`/`LINK`/`IMG` shows a reload banner |
| API offline | Existing `OfflineBanner` plus the route error boundary with correlation id |

## Cross-cutting risks (X-11 … X-22)

These are the programme-level cross-cutting risk identifiers applied to the
release-readiness scope.

| ID | Risk | Impact | Mitigation | Evidence |
|---|---|---|---|---|
| X-11 | A new route bypasses the accessibility matrix | Undetected axe violation | The matrix is generated from `SCREENS`; a new screen without a scan is visible in the spec diff | `accessibility.spec.ts` |
| X-12 | Keyboard traps or invisible focus | Keyboard users blocked | Focus-visible assertions, drawer Escape/focus return, skip-link test | `accessibility.spec.ts`, `shell.spec.ts` |
| X-13 | Screen readers announce duplicate or missing landmarks | Navigation confusion | One `h1`/`main` per route, navigation landmark asserted; manual NVDA/VoiceOver procedure documented | E2E + [`../accessibility.md`](../accessibility.md) |
| X-14 | Layout breaks at 320 px | Blocked mobile use | Full width matrix; two real overflows fixed | `responsive.spec.ts` |
| X-15 | Animations ignore reduced motion | Motion sensitivity | Every element checked under `prefers-reduced-motion` | `responsive.spec.ts` |
| X-16 | Performance regresses silently | Slow releases | Lighthouse hard budgets + bundle budget | `lighthouserc.json`, `check-bundle-budget.mjs` |
| X-17 | Visual regressions ship | Trust and usability | 112 snapshots incl. route × state × viewport | `visual-baseline.spec.ts` |
| X-18 | RUM becomes a privacy or CSP hole | Data leak / blocked beacon | Same-origin ingest, route sanitisation, flag off by default, CSP `connect-src 'self'` | `monitoring.ts`, `app/api/rum/route.ts` |
| X-19 | Stale feature flags accumulate | Dead code and unclear behaviour | Owner + expiry registry, fail-closed expiry, CI stale check | `featureFlags.ts`, `check-release-policy.mjs` |
| X-20 | Bad canary is not rolled back | Extended outage | Machine-readable thresholds + Prometheus alerts + documented rollback with RTO < 30 min | `canary-policy.json`, alerts, runbook |
| X-21 | UAT passes by anecdote | Unknown user readiness | 10 tasks, ≥ 90% threshold, evidence table | [`../uat-plan.md`](../uat-plan.md) |
| X-22 | Degraded modes are untested | Blank page for some users | JS-disabled, slow-3G, older-browser, forced-colors and asset-failure coverage | E2E + Jest |

## Test matrix

| ID | Level | Scenario | Implementation |
|---|---|---|---|
| T10-01 | E2E | axe every route × state | `e2e/accessibility.spec.ts` |
| T10-02 | E2E | forced-colors axe | `e2e/accessibility.spec.ts` |
| T10-03 | E2E | landmarks, single `h1`, skip link | `e2e/accessibility.spec.ts` |
| T10-04 | E2E | keyboard-only dashboard journey | `e2e/shell.spec.ts` |
| T10-05 | E2E | 320–1920 px matrix | `e2e/responsive.spec.ts` |
| T10-06 | E2E | 200% zoom and reduced motion | `e2e/responsive.spec.ts` |
| T10-07 | E2E | slow 3G and older browser notices | `e2e/responsive.spec.ts` |
| T10-08 | E2E | JS-disabled notice | `e2e/shell.spec.ts` |
| T10-09 | E2E | in-app tour flag on/off and dismissal | `e2e/shell.spec.ts` + `components/layout/__tests__/InAppTour.test.tsx` |
| T10-10 | Visual | route × state × viewport | `e2e/visual-baseline.spec.ts` |
| T10-11 | Unit | flag evaluation on/off, expiry, registry integrity | `lib/__tests__/featureFlags.test.ts` |
| T10-12 | Unit | canary policy and rollback thresholds | `lib/__tests__/releaseReadiness.test.ts` |
| T10-13 | Unit | RUM redaction, sender flag, payload validation | `lib/__tests__/monitoring.test.ts` |
| T10-14 | Unit | browser support and slow-connection detection | `lib/__tests__/browserSupport.test.ts` |
| T10-15 | Node | policy/config/runbook consistency and stale flags | `scripts/test/check-release-policy.test.mjs` |
| T10-16 | CI | Lighthouse budgets | `.github/lighthouse/lighthouserc.json` |

## Commands executed for this phase

```bash
cd frontend
pnpm typecheck
pnpm lint
pnpm jest --runInBand
pnpm lint:inline
pnpm lint:colors
pnpm budget
pnpm build
E2E_EXTERNAL_STACK=1 E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test   # full suite, mocked backend
E2E_EXTERNAL_STACK=1 E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/visual-baseline.spec.ts  # twice
cd ..
node --test scripts/test/check-release-policy.test.mjs
node scripts/check-release-policy.mjs
node scripts/check-doc-links.mjs
node scripts/openapi-controller-coverage.mjs
make coverage-baseline
```

## Honest limitations

- NVDA and VoiceOver passes are documented procedures, not executed CI steps.
  The automated landmark/name/live-region checks are the regression net.
- The 200% zoom check uses a 640 px viewport (half of 1280 px); browser zoom
  rendering itself is not exercised.
- Lighthouse INP and FCP are warnings in CI because one sample is noisy; a
  release decision uses the median of three local runs.
- RUM is wired and unit-tested but no RUM dashboard or alert consumes the
  `rum-vital` log line yet; the integration point is documented in
  [`../observability-rum.md`](../observability-rum.md).
- The canary was not executed: no traffic was shifted and no live rollback was
  triggered. The policy, alerts and runbook are implemented and validated.
- UAT has not been run; [`../uat-plan.md`](../uat-plan.md) records the tasks,
  threshold and the evidence required.
- The JavaScript-disabled and older-browser notices are informational; the
  application is a client-rendered React app and cannot provide a full
  server-only fallback journey.

# Phase 0 — Stabilisation, CSP and measurement baseline

**Status:** implemented on `feat/phase-0-ui-stabilization`
**Owner:** Frontend platform
**Related:** [`design-system.md`](design-system.md), [`../csp.md`](../csp.md), [`../accessibility.md`](../accessibility.md), [`../correlation-ids.md`](../correlation-ids.md)

## Goal

Stop the CSP-induced breakage, replace the unmeasured UI baseline with evidence,
and make every later phase close against an automated gate. A phase only closes
when design, development, tests, accessibility, performance and security are all
green.

## Workstreams

| # | Workstream | Implementation |
|---|---|---|
| 1 | CSP violation inventory | `e2e/console-errors.spec.ts` fails on any `securitypolicyviolation`, console error or React hydration error on every route. |
| 2 | Policy revision | [`frontend/lib/csp.ts`](../../frontend/lib/csp.ts) and [`frontend/proxy.ts`](../../frontend/proxy.ts) emit a per-request nonce policy with `script-src-attr 'none'` and a scoped `style-src-attr` exception. |
| 3 | Inline-style removal | Login, register, dashboard, tasks, workflows, app shell, shared query states, task detail, start-workflow dialog, notifications and the simple operational screens now use `.awap-*` classes from [`globals.css`](../../frontend/app/globals.css). |
| 4 | Hydration fixes | The active tenant is read after mount ([`useActiveTenant.ts`](../../frontend/lib/hooks/useActiveTenant.ts)); notification timestamps use a UTC-pinned formatter ([`format.ts`](../../frontend/lib/format.ts)). |
| 5 | CSP reporting | [`app/api/csp-report/route.ts`](../../frontend/app/api/csp-report/route.ts) accepts legacy and Reporting API payloads, stores a deduplicated aggregate and exposes a summary. The admin dashboard is `frontend/app/(app)/admin/csp/page.tsx`. |
| 6 | Measurement baseline | axe (`e2e/accessibility.spec.ts`), visual snapshots (`e2e/visual-baseline.spec.ts`), Lighthouse CI (`.github/lighthouse/lighthouserc.json`), inline-style ratchet (`scripts/check-inline-styles.mjs`), bundle budget (`scripts/check-bundle-budget.mjs`). |
| 7 | Error tracking | `ApiError` carries the backend `x-correlation-id`; `ErrorState`, the route boundary and the global boundary render it as a reference. |
| 8 | Zero-console-error gate | `pnpm test:e2e` includes `console-errors.spec.ts`; CI fails on any console error. |

## CSP policy

```text
default-src 'self';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
script-src-attr 'none';
style-src 'self' 'nonce-<per-request>';
style-src-elem 'self' 'nonce-<per-request>';
style-src-attr 'unsafe-inline';   <- time-limited exception
img-src 'self' data: blob:;
font-src 'self';
media-src 'self' blob:;
connect-src 'self' <API_ORIGINS>;
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
frame-ancestors 'none';
frame-src 'none';
base-uri 'self';
form-action 'self';
[upgrade-insecure-requests in production];
report-uri /api/csp-report;
report-to csp-endpoint
```

`unsafe-eval` is never emitted. `unsafe-inline` is scoped to **style attributes
only**; inline `<style>` and `<script>` elements still require the nonce.

### The time-limited exception

| Field | Value |
|---|---|
| Tracking reference | `AWAP-UIUX-PHASE-0` |
| Expiry | `2026-12-31T00:00:00.000Z` |
| Switch-off flag | `CSP_STYLE_ATTR_UNSAFE_INLINE=false` |
| Observability | `X-CSP-Style-Attr-Exception` response header |

`resolveStyleAttrException()` throws after the expiry, which fails the build
until the exception is removed or explicitly switched off. The ratchet guard
(`pnpm lint:inline`) ensures the number of inline styles can only go down.

## CSP report collector

| Request | Behaviour |
|---|---|
| `POST /api/csp-report` with a valid legacy or Reporting API payload | Redacted, deduplicated, recorded, optionally forwarded to `CSP_REPORT_COLLECTOR_URL`, answered `204`. |
| `POST` with invalid JSON or an unrecognised body | `400` (U0-01). |
| `GET /api/csp-report` | Redacted aggregate: totals, unique count, directives, routes and the 20 most recent entries. `Cache-Control: no-store`. |
| `GET /admin/csp` | Admin dashboard that polls the aggregate every 15 seconds. |

Deduplication window: 60 seconds. Retention: 24 hours. Maximum entries: 500.

## Design-system baseline

Tokens, component classes, state rules and accessibility requirements are in
[`design-system.md`](design-system.md). Key guarantees:

- no hard-coded hex in components; every colour is an `--awap-*` token;
- 14 px base with a 1.25 scale, 4 px spacing grid, 44 px minimum target;
- visible `:focus-visible` outline, skip link, landmarks, `aria-live` states;
- `prefers-reduced-motion` disables animation; `forced-colors` keeps borders;
- mobile breakpoint turns the sidebar into a horizontal bar and tables into
  cards;
- `en` and `tr` catalogs live in `frontend/messages/*.json`;
- dates and numbers use `Intl.*` with an explicit `timeZone: "UTC"`.

## Risk register

| ID | Risk | Impact | Mitigation | Metric |
|---|---|---|---|---|
| R0-01 | `unsafe-inline` becomes permanent | XSS surface | Expiry throws the build; env switch-off; header advertises expiry | exception active = 0 after 2026-12-31 |
| R0-02 | Hydration fix changes layout | Visual regression | Committed visual baseline + 0.1% tolerance | diff < 0.1% |
| R0-03 | CSP report flood | Alarm fatigue | 60 s dedupe, 500-entry cap, grouped dashboard | unique violations |
| R0-04 | Baseline incomplete | False improvement | Route × state matrix in axe + console + visual suites | coverage 100% of `SCREENS` |
| R0-05 | CI becomes slow | Developer experience | Reuse the existing build, one Playwright worker, cached browsers | CI < 15 min |

## Test matrix

| ID | Level | Scenario | Implementation | Measurement |
|---|---|---|---|---|
| T0-01 | E2E | Every route | `e2e/console-errors.spec.ts` | CSP violations = 0 |
| T0-02 | E2E | Console/page errors | `e2e/console-errors.spec.ts` | errors = 0 |
| T0-03 | E2E | Hydration | `e2e/console-errors.spec.ts` | React #418/#423 = 0 |
| T0-04 | Unit | CSP builder | `lib/__tests__/csp.test.ts` | nonce present, no unsafe script, exception scoped |
| T0-05 | Visual | 4 viewports | `e2e/visual-baseline.spec.ts` | diff < 0.1% |
| T0-06 | A11y | Every route × state | `e2e/accessibility.spec.ts` | critical/serious = 0 |
| T0-07 | Perf | Lighthouse | `.github/lighthouse/lighthouserc.json` | performance ≥ 90, LCP < 2.5 s, CLS < 0.1, TBT < 200 ms |
| T0-08 | Unit | Inline-style lint | `scripts/check-inline-styles.mjs` + `scripts/test/check-inline-styles.test.mjs` | regressions = 0 |
| T0-09 | E2E | CSP report | `e2e/csp-report.spec.ts` | 204 + recorded summary |
| T0-10 | CI | Bundle | `scripts/check-bundle-budget.mjs` + test | route ≤ 250 KB gzip |
| T0-11 | Unit | Report aggregator | `lib/__tests__/cspReports.test.ts` | dedupe/grouping/TTL/cap |
| T0-12 | Unit | Formatting + i18n | `lib/__tests__/format.test.ts`, `lib/__tests__/i18n.test.ts` | deterministic output |
| T0-13 | Unit | Correlation ID | `lib/__tests__/apiCorrelation.test.ts`, `QueryState.test.tsx` | ID rendered |
| T0-14 | E2E | 200% zoom + reduced motion | `e2e/responsive.spec.ts` | no horizontal scroll; transition ≤ 0.01 s |

## Unhappy-path matrix

| ID | Scenario | Expected | Covered by |
|---|---|---|---|
| U0-01 | Malformed CSP report | `400` | `e2e/csp-report.spec.ts` |
| U0-02 | Script without nonce | Blocked, app still works | `e2e/security-headers.spec.ts` |
| U0-03 | Offline | Banner + retry | `OfflineBanner` + `prefers-reduced-motion` rules |
| U0-04 | 500 | Error state + correlation reference | `app/(app)/error.tsx`, `ErrorState` |
| U0-05 | Chunk fails to load | Route boundary offers retry | `app/(app)/error.tsx` |
| U0-06 | 200% zoom | No horizontal scroll | Responsive `.awap-*` layout, mobile rules |
| U0-07 | Reduced motion | Animations 0 s | `@media (prefers-reduced-motion: reduce)` |

## Definition of done

- [x] Zero CSP violations, console errors and hydration errors on every route.
- [x] Nonce policy with no unsafe script execution.
- [x] Scoped, tracked, expiring style-attribute exception.
- [x] CSP collector with 204/400 contract and admin dashboard.
- [x] Design tokens and component classes replace inline styles on the named
      Phase 0 screens.
- [x] Hydration-safe tenant read and UTC timestamp formatting.
- [x] Correlation ID visible in API errors and route boundaries.
- [x] axe, visual, Lighthouse, inline-style and bundle gates wired into CI.
- [x] `en`/`tr` catalogs and typed translation helper.
- [x] This document and the design-system document are in English.

## Commands

```bash
cd frontend
pnpm test              # Jest unit tests
pnpm test:scripts      # guard-script unit tests
pnpm typecheck
pnpm lint
pnpm lint:inline       # ratchet (regressions fail)
pnpm build && pnpm budget
pnpm test:e2e          # includes CSP, console, visual and accessibility suites
```

## Removing the exception

1. Run `pnpm lint:inline` and clear the residual entries in
   `scripts/inline-style-baseline.json` screen by screen.
2. Regenerate the baseline with `pnpm lint:inline:baseline`.
3. Set `CSP_STYLE_ATTR_UNSAFE_INLINE=false` in staging and verify
   `e2e/console-errors.spec.ts` stays green.
4. Remove the `style-src-attr 'unsafe-inline'` branch from `buildCsp` before the
   `2026-12-31` expiry. The build fails if this step is forgotten.

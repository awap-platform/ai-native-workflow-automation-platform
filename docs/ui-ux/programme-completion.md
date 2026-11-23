# Programme completion — UI/UX phases 0–10

This page maps every UI/UX phase to its evidence and closes the programme
against the global Definition of Done. "Evidence" means a committed document,
test or configuration that a reviewer can open and run; manual process steps are
listed separately and are not claimed as executed.

## Phase map

| Phase | Scope | PR | Evidence |
|---|---|---|---|
| 0 | Stabilisation, CSP hardening, measurement baseline | #344 | [`phase-0-stabilization.md`](phase-0-stabilization.md), `e2e/console-errors.spec.ts`, `e2e/accessibility.spec.ts`, `e2e/visual-baseline.spec.ts`, `.github/lighthouse/lighthouserc.json` |
| 1 | Design system and app shell | #346 | [`design-system.md`](design-system.md), [`phase-1-design-system.md`](phase-1-design-system.md), `e2e/shell.spec.ts`, `e2e/design-system.spec.ts` |
| 2 | Onboarding, sign-in and tenant flows | #347 | [`phase-2-onboarding-auth.md`](phase-2-onboarding-auth.md), `e2e/auth-journey.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/invitation.spec.ts` |
| 3 | Work item inbox and 360 detail | #348 | [`phase-3-task-inbox.md`](phase-3-task-inbox.md), `e2e/task-inbox.spec.ts` |
| 4 | Workflow catalogue and instance monitor | #350 | [`phase-4-catalogue-instances.md`](phase-4-catalogue-instances.md), `e2e/workflow-instance.spec.ts`, `e2e/tenant-isolation.spec.ts` |
| 5 | Designer parity and workflow creation | #351 | [`phase-5-designer-parity.md`](phase-5-designer-parity.md), `e2e/workflow-designer-phase5.spec.ts`, `e2e/workflow-designer-dragdrop.spec.ts`, `e2e/workflow-designer-conditions.spec.ts` |
| 6 | Form builder and form filling | #352 | [`phase-6-form-builder.md`](phase-6-form-builder.md), `e2e/form-builder-phase6.spec.ts`, `e2e/form-file-submission.spec.ts` |
| 7 | Documents, notifications and templates | #353 | [`phase-7-documents-notifications.md`](phase-7-documents-notifications.md), `e2e/phase-7-documents-notifications.spec.ts`, `e2e/document-scan-live.spec.ts`, `e2e/notification-templates.spec.ts` |
| 8 | Analytics and admin/idem console | #354 | [`phase-8-analytics-admin.md`](phase-8-analytics-admin.md), `e2e/phase-8-analytics-admin.spec.ts` |
| 9 | AI Copilot experience | #355 | [`phase-9-ai-copilot.md`](phase-9-ai-copilot.md), `e2e/phase-9-ai-copilot.spec.ts`, `e2e/copilot-journey.spec.ts` |
| 10 | Accessibility, performance and release readiness | this PR | [`phase-10-release-readiness.md`](phase-10-release-readiness.md), [`../accessibility.md`](../accessibility.md), [`../uat-plan.md`](../uat-plan.md), [`../release-runbook.md`](../release-runbook.md), [`../observability-rum.md`](../observability-rum.md) |

## Global Definition of Done

The programme is done when every line below has an automated check, or an
honestly recorded manual step.

- [x] **Design** — every screen uses the documented tokens/classes; no hard-coded
  hex (`pnpm lint:colors`) and no new inline styles (`pnpm lint:inline`).
- [x] **Development** — `pnpm typecheck`, `pnpm lint`, `pnpm build` and the bundle
  budget pass; no `console`/CSP/hydration errors on any route
  (`e2e/console-errors.spec.ts`).
- [x] **Testing** — unit, guard-script, Pact, backend and E2E suites are required
  checks; coverage ratchets and the baseline are enforced by the backend job.
- [x] **Accessibility** — axe reports zero critical/serious violations on every
  route × state, in normal and forced-colors modes; keyboard focus and skip link
  are automated; NVDA/VoiceOver procedures are documented in
  [`../accessibility.md`](../accessibility.md).
- [x] **Responsive** — no horizontal scroll at 320, 360, 390, 768, 1024, 1440 and
  1920 px; 200% zoom equivalent and reduced motion verified.
- [x] **Performance** — Lighthouse budgets (performance ≥ 90, LCP < 2.5 s,
  CLS < 0.1, TBT < 200 ms, INP warning) and a per-route bundle ceiling.
- [x] **Visual regression** — 112 committed snapshots covering route × state ×
  viewport; baselines regenerated and verified twice against the production
  build on port 3100. Structural overlap/overflow assertions and a human
  baseline review checklist live in
  [`visual-baseline-review.md`](visual-baseline-review.md).
- [x] **Security** — nonce CSP with `script-src-attr 'none'`, `unsafe-eval`
  absent, secret/dependency/image scans are required checks, RUM ingest is
  same-origin and redacted.
- [x] **Observability** — metrics/traces/logs proof job, release-guard alerts
  validated by `promtool` and rule tests, RUM log integration documented.
- [x] **Release** — release-please flow, release checks, canary policy
  (5% → 25% → 100%) and thresholds validated by code and tests.
- [x] **Rollback** — runbook with RTO < 30 minutes, rollback drill procedure and
  release-guard alerts linked to the runbook section.
- [x] **Feature flags** — every flag has an owner and expiry; expired flags fail
  closed and fail the CI policy check; no stale flag may remain.
- [x] **Fallbacks** — JS disabled, slow 3G, older browser, high contrast and
  asset/CDN failure states are implemented and tested where automation is
  feasible.
- [x] **Documentation** — phase evidence, runbooks, UAT plan, accessibility
  procedures and this completion map; every relative link resolves
  (`scripts/check-doc-links.mjs`).
- [ ] **UAT** — the 10-task plan is written with a ≥ 90% threshold
  ([`../uat-plan.md`](../uat-plan.md)); the sessions require real users and have
  **not** been executed.
- [ ] **Screen-reader pass** — NVDA and VoiceOver procedures are documented;
  the manual passes have **not** been executed in this PR.
- [ ] **Live canary and rollback drill** — the policy, alerts and runbook are
  implemented; no live traffic shift or drill has been performed.

The three unchecked items are deliberate: they are people/process steps. They
must be completed before the programme is declared operationally closed, and the
release ticket must carry their evidence.

## Cross-phase invariants

- One navigation model ([`../../frontend/lib/navigation.ts`](../../frontend/lib/navigation.ts))
  drives sidebar, palette, breadcrumbs and E2E route coverage.
- One shared screen matrix ([`../../frontend/e2e/a11yFixtures.ts`](../../frontend/e2e/a11yFixtures.ts))
  drives axe, console, visual and responsive suites; adding a route without
  coverage is a visible diff.
- One policy gate ([`../../scripts/check-release-policy.mjs`](../../scripts/check-release-policy.mjs))
  ties canary thresholds, flag expiry, overlay flags and runbook anchors
  together.

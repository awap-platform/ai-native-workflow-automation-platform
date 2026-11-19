# Accessibility coverage

Issue #184 expands accessibility from a single home-page scan to every
user-facing screen. The suite lives in
[`frontend/e2e/accessibility.spec.ts`](../frontend/e2e/accessibility.spec.ts) and
uses the shared fixtures in
[`frontend/e2e/a11yFixtures.ts`](../frontend/e2e/a11yFixtures.ts).

## Screen and state matrix

| Screen | Route | Empty | Populated | Notes |
|---|---|:---:|:---:|---|
| Login | `/` | ✅ | — | Form labels and error live region |
| Register | `/register` | ✅ | — | Wizard labels validated across all steps |
| Invitation acceptance | `/invitations/accept?token=…` | ✅ | — | Public token form; new/existing account modes |
| Tenant selection | `/select-tenant` | — | ✅ | Two memberships shown as cards |
| Dashboard | `/dashboard` | ✅ | ✅ | Tasks/instances counts |
| AI Copilot | `/copilot` | ✅ | ✅ | Natural-language request, HITL warning and tool-call list |
| Tasks | `/tasks` | ✅ | ✅ | Populated state opens the task detail panel |
| Workflows | `/workflows` | ✅ | ✅ | Populated state opens the start dialog |
| Workflow designer | `/workflows/designer` | ✅ | ✅ | Populated state adds a TASK node |
| Form builder | `/forms/builder` | ✅ | ✅ | Populated state adds a TEXT field inspector |
| Form fill | `/forms/fill` | ✅ | ✅ | Populated state selects the form and renders its fields |
| Documents | `/documents` | ✅ | ✅ | Live scan-status region |
| Notifications | `/notifications` | ✅ | ✅ | Unread live region |
| Notification templates | `/notification-templates` | ✅ | ✅ | List + editor |
| Analytics | `/analytics` | ✅ | ✅ | Empty and aggregate tables |
| Workflow instances | `/instances` | ✅ | ✅ | State labels |
| Organizations | `/organizations` | ✅ | ✅ | Empty and nested tree |
| CSP reports | `/admin/csp` | ✅ | — | Redacted aggregate dashboard |
| Design system | `/design-system` | ✅ | — | 32-component catalogue; light + dark axe |

Keyboard focus is exercised on every screen. Form-label, live-region and
error-announcement checks run for login, register, documents and notifications.

## Gate

- axe tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.
- A `critical` or `serious` violation fails the Playwright test.
- Color contrast is covered by the `color-contrast` rule in the same tags.
- Keyboard tests require the first real control to receive focus and show an
  outline/box-shadow focus indicator. Next.js dev-only `NEXTJS-PORTAL` elements
  are skipped because they do not exist in production.
- Every scan is written to `frontend/a11y-report/report.json`; CI uploads it as
  the `a11y-report` artifact even when a screen fails.

## Local commands

```bash
cd frontend
pnpm test:a11y
```

The suite uses deterministic API mocks, so it does not need Postgres, Kafka or a
backend. Animations are reduced with `prefers-reduced-motion`; no inline style is
injected because the CSP would block it.

Phase 2 adds onboarding/auth coverage:

- [`e2e/login-security.spec.ts`](../frontend/e2e/login-security.spec.ts) —
  enumeration-safe errors, 429/Retry-After, expired banner, safe `returnTo` and
  double-submit protection.
- [`e2e/register-onboarding.spec.ts`](../frontend/e2e/register-onboarding.spec.ts)
  — wizard steps, empty/long/duplicate input, password strength and double submit.
- [`e2e/tenant-picker.spec.ts`](../frontend/e2e/tenant-picker.spec.ts) —
  auto-select, multi-tenant card choice, 403/500 and no-access CTA.
- [`e2e/invitation.spec.ts`](../frontend/e2e/invitation.spec.ts) — new/existing
  user acceptance and expired/consumed token recovery.
- [`e2e/onboarding.spec.ts`](../frontend/e2e/onboarding.spec.ts) — first-login
  access summary and persistent dismissal.
- [`e2e/session-timeout.spec.ts`](../frontend/e2e/session-timeout.spec.ts) —
  countdown, stay-signed-in refresh and failed-refresh return to login.

Phase 1 adds shell and catalogue coverage:

- [`e2e/shell.spec.ts`](../frontend/e2e/shell.spec.ts) — every sidebar route,
  mobile drawer + Escape focus restoration, Ctrl+K command palette, role-hidden
  admin menu/forbidden URL, 404 and 320 px reflow.
- [`e2e/design-system.spec.ts`](../frontend/e2e/design-system.spec.ts) — axe in
  light and dark, theme toggle, long Turkish text and 4 × 2 visual baselines.

The phase 0 companions are:

- [`e2e/console-errors.spec.ts`](../frontend/e2e/console-errors.spec.ts) — zero
  console errors, page errors, hydration errors and CSP violations on every
  screen in `SCREENS`.
- [`e2e/visual-baseline.spec.ts`](../frontend/e2e/visual-baseline.spec.ts) —
  four viewports for the deterministic screens.
- [`e2e/responsive.spec.ts`](../frontend/e2e/responsive.spec.ts) — 200% zoom
  reflow and reduced-motion collapse.

## Unhappy paths

The suite is expected to fail when:

- a form control loses its accessible name (login/register/task detail/file
  input/form selects);
- a low-contrast control is introduced;
- a status change loses its `aria-live` region;
- a screen cannot be seeded (the fixture fails instead of skipping).

A focus trap is only meaningful for a modal. The current UI uses inline detail
panels and dialogs without a modal overlay; when a real modal is introduced, add
a keyboard trap test to this suite.

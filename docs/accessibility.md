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
| Task inbox | `/tasks` | ✅ | ✅ | Split pane: filters, saved views, bulk toolbar, J/K/Enter/A/R shortcuts |
| Work item 360 | `/tasks?task=…` | — | ✅ | Detail tabs: context, decision, history, attachments, variables |
| Workflow catalogue | `/workflows` | ✅ | ✅ | Cards/table, filters and the start dialog with a JSON preview |
| Workflow designer | `/workflows/designer` | ✅ | ✅ | Grouped palette, validation panel, navigator and properties; populated state adds a TASK node |
| Form builder | `/forms/builder` | ✅ | ✅ | Populated state adds a TEXT field inspector |
| Form fill | `/forms/fill` | ✅ | ✅ | Populated state selects the form and renders its fields |
| Documents | `/documents` | ✅ | ✅ | Live scan-status region |
| Notifications | `/notifications` | ✅ | ✅ | Unread live region |
| Notification templates | `/notification-templates` | ✅ | ✅ | List + editor |
| Analytics | `/analytics` | ✅ | ✅ | Empty and aggregate tables |
| Workflow instances | `/instances` | ✅ | ✅ | State filter, export and deep links |
| Instance detail | `/instances/{id}` | — | ✅ | Timeline, redacted logs, saga and guarded operator actions |
| Organizations | `/organizations` | ✅ | ✅ | Empty and nested tree |
| CSP reports | `/admin/csp` | ✅ | — | Redacted aggregate dashboard |
| Design system | `/design-system` | ✅ | — | 32-component catalogue; light + dark axe |

Keyboard focus is exercised on every screen. Form-label, live-region and
error-announcement checks run for login, register, documents and notifications.

The task inbox adds a dedicated keyboard contract: `J`/`K` move the row cursor,
`Enter` focuses the detail heading, `A` opens the approval confirmation and `R`
opens the rejection confirmation (which still requires a comment). The phone
layout moves the work item to `/tasks/[id]` instead of shrinking the split pane.

## Phase 5 workflow designer

The designer is fully operable without a pointer:

- The palette is a set of grouped native buttons. The search field (`Search node
  types`) exposes a cursor; `ArrowUp`/`ArrowDown`, `Home` and `End` move it and
  `Enter` inserts the highlighted type.
- The transition composer provides labelled source/target selects and an
  `Add transition` submit button, so an edge can be created with the keyboard.
- `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+C`, `Ctrl/Cmd+V`, `Ctrl/Cmd+D`
  and `Delete` operate on the current canvas selection.
- The Process Navigator is an ordered button list; activating an entry selects
  and centres the node, matching a canvas click.
- Validation issues are buttons. Activating one focuses the offending node or
  transition, so screen-reader users can jump from an error to its cause.
- Autosave and publish outcomes are announced in `role="status"` live regions;
  save and publish failures use `role="alert"`.
- The properties panel labels every field (`Node name`, `Timeout seconds`,
  `Assignees`, `Form definition ID`, `AI prompt`, `Script expression`,
  `Gateway condition`, and so on). Labels are React text, never markup.
- The canvas keeps the React Flow default tab order and adds explicit
  `Zoom in`, `Zoom out` and `Fit view` buttons next to the mini-map.
- Unsaved work adds a browser `beforeunload` prompt and asks for confirmation
  before ordinary same-origin link navigation.

## Phase 6 form builder and fill

Both form screens are covered by the axe matrix (`form-builder` and `form-fill`
in [`e2e/a11yFixtures.ts`](../frontend/e2e/a11yFixtures.ts)) and add a keyboard
contract of their own:

- The palette is a group of native buttons named after the field type (`TEXT`,
  `TEXTAREA`, …). Enter appends the field; the search box (`Search field types`)
  filters the list and announces an empty result in a live region.
- Canvas rows expose `Select <label>`, `Move <label> up`, `Move <label> down` and
  `Remove <label>` buttons, so reordering never requires a pointer. Screen
  readers get the position number, the field type and any condition/calculation
  as text inside the row button.
- The properties panel labels every control (`Field id`, `Label`, `Help text`,
  `Required`, `Minimum length`, `Maximum length`, `Pattern (regular
  expression)`, `Calculated expression`, `Options (one per line)`, condition
  `Field`/`Operator`/`Value`).
- Validation problems are listed in a “Schema problems” list and inline on the
  row; saving is blocked while any problem exists.
- On submit, `FormErrorSummary` (`role="alert"`, `tabIndex={-1}`) receives focus
  and announces “N fields need attention”. Each entry is a button that focuses
  the control it describes, and controls carry `aria-invalid` plus
  `aria-describedby` pointing at the help and error text.
- MULTI_SELECT is a `fieldset`/`legend` group; BOOLEAN uses a single checkbox
  whose label is the field label; calculated NUMBER inputs are `readOnly` with
  `aria-readonly="true"`.
- Builder autosave, save outcomes and draft restore are announced in live
  regions; preview validation reuses the same summary.
- Focus indicators come from the shared `:focus-visible` outline on every form
  control, palette button, canvas button and summary link.
- Labels, help text and options are React text; the hostile-label test asserts an
  `<img onerror>` label renders as literal text and no element is created.

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

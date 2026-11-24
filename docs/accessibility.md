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
| AI Copilot | `/copilot` | ✅ | ✅ | Sessions, suggestions, live transcript (`aria-live`), streaming cancel, tool cards, citations, HITL panel, audit view and warnings |
| Task inbox | `/tasks` | ✅ | ✅ | Split pane: filters, saved views, bulk toolbar, J/K/Enter/A/R shortcuts |
| Work item 360 | `/tasks?task=…` | — | ✅ | Detail tabs: context, decision, history, attachments, variables |
| Workflow catalogue | `/workflows` | ✅ | ✅ | Cards/table, filters and the start dialog with a JSON preview |
| Workflow designer | `/workflows/designer` | ✅ | ✅ | Grouped palette, validation panel, navigator and properties; populated state adds a TASK node |
| Form builder | `/forms/builder` | ✅ | ✅ | Populated state adds a TEXT field inspector |
| Form fill | `/forms/fill` | ✅ | ✅ | Populated state selects the form and renders its fields |
| Documents | `/documents` | ✅ | ✅ | Live scan-status region, upload progress, scan timeline and infected alert |
| Notifications | `/notifications` | ✅ | ✅ | Unread live region, labelled filters, bulk toolbar and suppression table |
| Notification templates | `/notification-templates` | ✅ | ✅ | List + editor, placeholder chips and warning live region |
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

## Phase 7 documents, notifications and templates

The documents and notification screens stay in the axe matrix and gain an explicit keyboard and
live-region contract:

- The upload dropzone is a labelled file input with `Upload a document` as its accessible name. The
  progress element carries `Upload progress for <file>`, and the percentage text is a `role="status"`
  live region. `Cancel upload` is a normal button; cancelling announces whether the pending version
  was removed.
- Each document row renders a `Scan timeline for <file>` ordered list. A scan status change is
  announced through the atomic `role="status"` announcer, and an `INFECTED` result adds a
  `role="alert"` banner. The Phase 7 E2E test runs axe against that alert and requires zero serious or
  critical violations.
- Download stays disabled until the row is promoted, so a keyboard or screen-reader user cannot
  request a URL for a quarantined file.
- `Show versions` is an `aria-expanded` toggle; the resulting table is named
  `Version history for <file>`.
- The notification filters are labelled native selects and an input inside a `role="search"` region.
  The visible/total count and the unread badge are polite live regions.
- Bulk selection uses native checkboxes with per-row accessible names. The bulk toolbar is a labelled
  group; a partial failure is announced instead of claiming success.
- The suppression table has labelled columns and states the channel, recipient, reason and timestamp.
- Template placeholders are text chips (never markup). The variables text area has a labelled
  description, empty/unused variable warnings use `role="status"`, and a save or preview failure uses
  `role="alert"`.

See [`ui-ux/phase-7-documents-notifications.md`](ui-ux/phase-7-documents-notifications.md) for the
behaviour, test map and honest limitations (including the session-scoped scan timeline).

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

## Phase 8 analytics and admin consoles

The analytics, identity, operate and audit screens are in the axe matrix and add an explicit
keyboard/live-region contract:

- Analytics filters are labelled native date inputs and selects. A reversed range is announced
  through a `role="alert"` message and no request is sent.
- The bar chart is a single labelled SVG image. Every value it draws is repeated in the accessible
  totals and daily tables, so no information depends on the visual bars alone.
- Drill-down rows are a labelled table; previous/next controls are native buttons with a disabled
  boundary at the first and last page.
- Every privileged mutation opens an inline `role="alertdialog"` confirmation that names the
  target and states that the action is audited. Focus moves into the panel when it opens.
- Role, deletion, invitation, DLQ retry and export outcomes are announced in `role="status"` live
  regions; failures use `role="alert"` and keep the server's message.
- The permission matrix is a real table with a caption, column headers and row headers; grants
  carry an accessible `granted`/`not granted` label.
- The break-glass log is a definition list plus a captioned table; an unavailable snapshot is
  announced instead of rendering an empty table.

See [`ui-ux/phase-8-analytics-admin.md`](ui-ux/phase-8-analytics-admin.md) for the behaviour, test
map and honest limitations.

## Phase 10 release-readiness additions

[`ui-ux/phase-10-release-readiness.md`](ui-ux/phase-10-release-readiness.md)
extends the automated net and documents the manual passes.

### Automated

- Every screen is scanned in its empty and populated state with axe
  (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`); only `critical`/`serious`
  impact fails. The full report is uploaded as the `a11y-report` artifact.
- Forced-colors (`forcedColors: active`) scans cover login, register, dashboard,
  tasks and Copilot. `color-contrast` is disabled there because the operating
  system owns the palette; structure, names, roles and focus are still checked.
- Structural checks per route: exactly one `h1`, one `main` landmark, and a
  navigation landmark on protected screens.
- The skip link is asserted as the first keyboard stop and must target
  `#main-content`.
- A keyboard-only journey uses Tab to reach the sidebar and Enter to navigate.
- A 640 px viewport (200 % of 1280 px) must not scroll horizontally on the
  reflow-critical screens.
- Every transition/animation collapses under `prefers-reduced-motion: reduce`.
- Enabled controls keep a visible border under `forced-colors: active`.

### Manual screen-reader procedures

The full executable protocol lives in
[`accessibility/manual-pass-protocol.md`](accessibility/manual-pass-protocol.md).
CI has no physical screen reader, so the protocol is executed against the
Chromium accessibility tree and the evidence gate ties every T1–T10/U1–U6 row to
an executable test.

**NVDA + Firefox/Chrome (Windows)**

1. Start NVDA, open the application.
2. `H`: one level-1 heading per route; section headings in order.
3. `D`: banner, navigation and main landmarks announced once each.
4. Sign in with `Tab` only: labels, live-region errors and the skip link.
5. Task inbox `J`/`K` cursor announcements; `A`/`R` confirmation dialogs.
6. Documents and notifications: scan-status and unread live regions announce
   without moving focus.
7. Copilot: transcript streaming and citation reachability.

**VoiceOver + Safari (macOS/iOS)**

1. `Cmd+F5`, open the rotor with `VO+U`.
2. Landmarks rotor: banner, navigation, main.
3. Headings rotor: exactly one level-1 heading.
4. Forms rotor: every field labelled, errors announced.
5. iOS: swipe through the inbox; the tour dismiss button has a distinct label.

A failed step is a release blocker. The automated protocol run is evidence for
the accessibility-tree contract; physical NVDA and VoiceOver speech output is a
release-ticket attestation. The current status, limitations and owner are in
[`accessibility/evidence/2026-11-24-screen-reader-protocol.json`](accessibility/evidence/2026-11-24-screen-reader-protocol.json).

# Phase 1 — Design system and App Shell

**Status:** implemented on `feat/phase-1-design-system-app-shell`
**Owner:** Frontend platform
**Related:** [`design-system.md`](design-system.md), [`phase-0-stabilization.md`](phase-0-stabilization.md), [`../accessibility.md`](../accessibility.md), [`../csp.md`](../csp.md)

## Goal

Deliver one consistent, accessible, responsive visual language and a shell that
every authenticated screen uses. The shell carries identity (tenant + role),
global search, notifications, theme, language and keyboard navigation, while the
component catalogue is exercised by unit snapshots, axe, visual baselines and
end-to-end tests.

## Delivered components

The catalogue route `/design-system` renders 32 components:

| Group | Components |
|---|---|
| Actions | Button, IconButton |
| Text inputs | Input, Textarea, Select, DatePicker, Combobox |
| Choices | Checkbox, RadioGroup, Switch |
| Files | FileDropzone |
| Surfaces | Card, StatCard, Badge, Avatar, Skeleton, SkeletonGroup |
| Data | Table, DataGrid, Tabs, Pagination, Stepper, Timeline, Breadcrumb |
| Overlays | Dialog, Drawer, Tooltip, Popover, Menu, ConfirmDialog, Toast |
| Search | CommandPalette |
| States | LoadingState, EmptyState, ErrorState, ForbiddenState, OfflineState |

Every interactive component defines default, hover, focus-visible, active,
disabled, loading and error states. Buttons and links meet the 44 px target
where the layout allows it; icons always have an accessible name.

## Theme

- Tokens remain the single source of truth in [`globals.css`](../../frontend/app/globals.css); the hard-coded colour guard scans `components/ui`, `components/layout` and the catalogue route and currently reports **0**.
- `lib/theme.tsx` is a module-level external store read with `useSyncExternalStore`, so the server snapshot (`system` / `light`) and the client snapshot cannot cause hydration mismatch.
- The root layout injects a **nonce-carrying** pre-paint script ([`lib/themeScript.ts`](../../frontend/lib/themeScript.ts)). It reads `localStorage.awap_theme`, honours `prefers-color-scheme`, and adds `.dark` before first paint.
- `ThemeToggle` renders both icons and selects one with CSS, so the toggle markup is identical during hydration.
- Dark mode contrast is checked by axe through the catalogue suite.

## App Shell

| Surface | Implementation |
|---|---|
| Shell | [`components/layout/AppShell.tsx`](../../frontend/components/layout/AppShell.tsx) |
| Sidebar | [`components/layout/Sidebar.tsx`](../../frontend/components/layout/Sidebar.tsx) + [`SidebarNav.tsx`](../../frontend/components/layout/SidebarNav.tsx) |
| Topbar | [`components/layout/Topbar.tsx`](../../frontend/components/layout/Topbar.tsx) |
| Breadcrumb | `Breadcrumb` from [`components/ui/data-display.tsx`](../../frontend/components/ui/data-display.tsx) |
| Mobile drawer | [`components/layout/MobileDrawer.tsx`](../../frontend/components/layout/MobileDrawer.tsx) |
| Command palette | [`components/layout/GlobalCommandPalette.tsx`](../../frontend/components/layout/GlobalCommandPalette.tsx) |
| Navigation model | [`lib/navigation.ts`](../../frontend/lib/navigation.ts) |

- The sidebar is grouped exactly as the programme IA: My Work, Design, Operate,
  AI, Admin.
- The topbar shows the active tenant and role (truncated with a native tooltip),
  unread notifications, AI entry point, theme, language and the user menu.
- Breadcrumbs are derived from the longest matching navigation item, so
  `/workflows/designer` is not shadowed by `/workflows`.
- Admin destinations are hidden for non-admin roles. A direct `/admin/*` URL
  renders the `ForbiddenState` **inside** the shell instead of dropping the
  navigation.
- Mobile navigation is a focus-trapped drawer; Escape closes it and focus
  returns to the hamburger trigger.
- `Ctrl+K` / `Cmd+K` opens the command palette. Navigation destinations and
  actions share the sidebar catalogue, so the palette cannot drift from the IA.

## States

- `LoadingState` uses an announced skeleton.
- `EmptyState` carries a call to action slot.
- `ErrorState` renders the backend correlation ID when available.
- `ForbiddenState` is used for role-denied routes.
- `OfflineState` provides an explicit retry action; the global `OfflineBanner`
  remains for connectivity changes.
- `PartialState` and `StaleState` remain available for data screens.

## Internationalisation

- Catalogs: [`messages/en.json`](../../frontend/messages/en.json) and [`messages/tr.json`](../../frontend/messages/tr.json).
- `lib/locale.tsx` provides `useI18n()` bound to the cookie-backed locale; the
  server layout reads `awap_locale`, so the first render is deterministic.
- Shell, auth screens, catalogue and states use the catalogs. The parity test
  (`lib/__tests__/i18nParity.test.ts`) fails on any missing or empty key.
- Turkish long-text handling is checked at 320 px; the shared `.awap-truncate`
  class and native `title` provide the fallback.

## Risk register

| ID | Risk | Mitigation | Metric |
|---|---|---|---|
| R1-01 | Component inflation | One catalogue, one navigation model, no duplicate primitives | unused exports = 0 |
| R1-02 | Token bypass | `pnpm lint:colors` scans the component and shell layers | hard-coded hex = 0 |
| R1-03 | Drawer focus escape | `useFocusTrap`, Escape, focus restoration | axe = 0; E2E Esc test |
| R1-04 | Dark-mode contrast | axe runs in light and dark | AA ≥ 4.5 |
| R1-05 | Text overflow | `.awap-truncate`, native `title`, Turkish 320 px test | overflow = 0 |

## Test matrix

| ID | Level | Scenario | Implementation |
|---|---|---|---|
| T1-01 | Unit | Variants and states | `components/ui/__tests__/design-system.test.tsx` + snapshots |
| T1-02 | Component | Disabled/loading buttons do not fire | same suite |
| T1-03 | A11y | All catalogue components | `e2e/design-system.spec.ts` (light + dark axe) |
| T1-04 | Visual | 4 viewports × light/dark | `e2e/design-system.spec.ts` (8 baselines) |
| T1-05 | E2E | Every sidebar route returns 200 + heading | `e2e/shell.spec.ts` |
| T1-06 | E2E | Mobile drawer + Esc restores focus | `e2e/shell.spec.ts` |
| T1-07 | E2E | Ctrl+K, ≥ 10 results, Enter navigates | `e2e/shell.spec.ts` |
| T1-08 | Unit | i18n parity | `lib/__tests__/i18nParity.test.ts` |
| T1-09 | Perf | Shell LCP < 2.5 s | `e2e/shell.spec.ts` (production stack) |
| T1-10 | Visual/E2E | Long Turkish text does not overflow | `e2e/design-system.spec.ts` |

## Unhappy-path matrix

| ID | Scenario | Expected | Covered by |
|---|---|---|---|
| U1-01 | Unknown route | 404 + link back | `e2e/shell.spec.ts`, `app/not-found.tsx` |
| U1-02 | Unauthorized admin menu / URL | Menu hidden; forbidden state | `e2e/shell.spec.ts` |
| U1-03 | Broken theme value | Falls back to `system` | `lib/__tests__/theme.test.ts` |
| U1-04 | Missing catalog key | Falls back to the default locale | `lib/__tests__/i18n.test.ts`, parity test |
| U1-05 | Long tenant name | Truncate + native tooltip | Topbar + sidebar |
| U1-06 | Tab inside drawer | Focus cannot leave | `useFocusTrap`, drawer E2E |
| U1-07 | 320 px viewport | No horizontal scroll | `e2e/shell.spec.ts`, Turkish test |

## Definition of done

- [x] Tokens + light/dark theme with FOUC-free, nonce-based bootstrap.
- [x] 32 component catalogue with unit snapshots and a `/design-system` story route.
- [x] AppShell + Sidebar + Topbar + Breadcrumb + MobileDrawer.
- [x] CommandPalette + global search with Ctrl+K.
- [x] Empty/Error/Skeleton/Forbidden/Offline states.
- [x] All authenticated routes use the new shell.
- [x] Keyboard shortcuts, focus trap and focus restoration.
- [x] `en`/`tr` catalogs with parity and long-text coverage.
- [x] Hard-coded colour guard = 0.
- [x] Catalogue, accessibility, visual and shell tests green.

## Commands

```bash
cd frontend
pnpm test                 # unit + snapshots
pnpm test:scripts         # guard scripts
pnpm typecheck
pnpm lint
pnpm lint:inline
pnpm lint:colors
pnpm build && pnpm budget
pnpm test:e2e             # includes shell, catalogue, a11y, visual and console gates
```

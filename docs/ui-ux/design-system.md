# AWAP design system

Source of truth: [`frontend/app/globals.css`](../../frontend/app/globals.css).
The CSS variables are exposed both as `--awap-*` custom properties and as
Tailwind `--color-awap-*` theme entries, so utility classes and component
classes share the same values.

## Tokens

| Category | Token | Rule |
|---|---|---|
| Colour | `--awap-bg`, `--awap-surface`, `--awap-surface-raised`, `--awap-primary`, `--awap-primary-foreground`, `--awap-danger`, `--awap-success`, `--awap-warning`, `--awap-text`, `--awap-muted`, `--awap-border` | Hard-coded hex values are forbidden in components. |
| Typography | `--awap-font-sans`, `--awap-text-xs`, `--awap-text-sm`, `--awap-text-md`, `--awap-text-lg`, `--awap-text-xl` | 14 px base; 1.25 scale. |
| Spacing | `--awap-space-1` … `--awap-space-12` | 4 px grid. Inline padding is forbidden. |
| Radius | `--awap-radius-sm` (4 px), `--awap-radius-md` (8 px), `--awap-radius-lg` (12 px), `--awap-radius-full` | — |
| Shadow | `--awap-shadow-1`, `--awap-shadow-2`, `--awap-shadow-3` | Only for elevation. |
| Motion | `--awap-motion-fast`, `--awap-motion-normal`, `--awap-ease` | `prefers-reduced-motion` is mandatory. |
| Z-index | `--awap-z-dropdown`, `--awap-z-modal`, `--awap-z-toast` | No ad-hoc stacking values. |

Dark mode overrides the same tokens under `.dark`; components never branch on
the theme.

## Component classes

| Area | Classes |
|---|---|
| Shell | `.awap-shell`, `.awap-sidebar`, `.awap-brand`, `.awap-nav`, `.awap-nav-group`, `.awap-nav-heading`, `.awap-nav-link`, `.awap-main` |
| Page | `.awap-page`, `.awap-page-title`, `.awap-section-title`, `.awap-muted`, `.awap-reading`, `.awap-form-wide` |
| Auth | `.awap-auth`, `.awap-auth-title`, `.awap-auth-subtitle` |
| Forms | `.awap-form`, `.awap-label`, `.awap-input`, `.awap-textarea`, `.awap-select`, `.awap-checkbox-row` |
| Actions | `.awap-button`, `.awap-button-primary`, `.awap-button-danger`, `.awap-button-ghost`, `.awap-link-button` |
| Surfaces | `.awap-card`, `.awap-card-header`, `.awap-list`, `.awap-list-row`, `.awap-table` |
| Feedback | `.awap-badge`, `.awap-badge-active`, `.awap-alert`, `.awap-alert-warning`, `.awap-alert-danger`, `.awap-skeleton`, `.awap-empty`, `.awap-error`, `.awap-banner`, `.awap-correlation` |
| States | `.awap-state`, `.awap-state-completed`, `.awap-state-failed`, `.awap-state-running`, `.awap-state-waiting`, `.awap-state-cancelled` |
| Accessibility | `.awap-skip-link`, `.sr-only` (Tailwind) |

Shared React state components live in
[`components/ui/QueryState.tsx`](../../frontend/components/ui/QueryState.tsx):
`LoadingState` (skeleton + live region), `ErrorState` (message + correlation
ID), `EmptyState`, `StaleState`, `PartialState` and `QueryState`.

## Interaction states

Every interactive component must define:

`default`, `hover`, `focus-visible`, `active`, `disabled`, `loading`, `error`,
`read-only` (where applicable).

## Screen states

Each data screen renders exactly one of:

| State | Component |
|---|---|
| loading | `LoadingState` (announced, skeleton keeps layout stable) |
| empty | `EmptyState` with a call to action |
| error | `ErrorState` with the optional correlation ID |
| partial | `PartialState` warning without hiding the usable data |
| success | Content |
| forbidden | `ErrorState` 403 branch |
| offline | Global `OfflineBanner` with retry |
| stale | `StaleState` while cached data is revalidated |

## Accessibility contract

- WCAG 2.1 AA, visible focus, skip link and landmarks.
- Every input has a programmatic label; errors use `aria-describedby`.
- Live updates use `aria-live`/`role="status"`; failures use `role="alert"`.
- Minimum target size 44 × 44 px; 200% zoom must not scroll horizontally.
- Colour never carries meaning alone; state text is always present.
- `prefers-reduced-motion` and `forced-colors` are handled in `globals.css`.

## Internationalisation

- Catalogs: `frontend/messages/en.json`, `frontend/messages/tr.json`.
- Helper: [`frontend/lib/i18n.ts`](../../frontend/lib/i18n.ts) (`t`, `plural`,
  `resolveLocale`, `formatNumberForLocale`, `formatDateTimeForLocale`).
- Interpolation uses `{name}`; plural selection uses `Intl.PluralRules`.
- Dates and numbers always go through `Intl.*` with `timeZone: "UTC"` so the
  server and the first client render match.
- Document layout is prepared for RTL: use logical CSS properties in new code.
- Tests cover Turkish characters and emoji-friendly string handling.

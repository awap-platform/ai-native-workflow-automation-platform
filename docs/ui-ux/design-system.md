# AWAP design system

Source of truth: [`frontend/app/globals.css`](../../frontend/app/globals.css) for
tokens and shared classes; [`frontend/components/ui`](../../frontend/components/ui)
for React components; [`frontend/lib/navigation.ts`](../../frontend/lib/navigation.ts)
for the navigation model. The living catalogue is `/design-system`.

## Tokens

| Category | Token | Rule |
|---|---|---|
| Colour | `--awap-bg`, `--awap-surface`, `--awap-surface-raised`, `--awap-primary`, `--awap-primary-foreground`, `--awap-danger`, `--awap-success`, `--awap-warning`, `--awap-text`, `--awap-muted`, `--awap-border` | Hard-coded hex values are forbidden in components; `pnpm lint:colors` enforces it. |
| Typography | `--awap-font-sans`, `--awap-text-xs`, `--awap-text-sm`, `--awap-text-md`, `--awap-text-lg`, `--awap-text-xl` | 14 px base; 1.25 scale. |
| Spacing | `--awap-space-1` … `--awap-space-12` | 4 px grid. |
| Radius | `--awap-radius-sm` (4 px), `--awap-radius-md` (8 px), `--awap-radius-lg` (12 px), `--awap-radius-full` | — |
| Shadow | `--awap-shadow-1`, `--awap-shadow-2`, `--awap-shadow-3` | Only for elevation. |
| Motion | `--awap-motion-fast`, `--awap-motion-normal`, `--awap-ease` | `prefers-reduced-motion` is mandatory. |
| Z-index | `--awap-z-dropdown`, `--awap-z-modal`, `--awap-z-toast` | No ad-hoc stacking values. |

`.dark` overrides the same tokens; components never branch on the theme.
`html` carries `color-scheme`, and the nonce-based bootstrap script applies the
stored preference before first paint.

## React components

| Area | Exports | File |
|---|---|---|
| Actions | `Button`, `buttonVariants`, `IconButton` | [`button.tsx`](../../frontend/components/ui/button.tsx), [`icon-button.tsx`](../../frontend/components/ui/icon-button.tsx) |
| Forms | `FormField`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `DatePicker`, `FileDropzone`, `Combobox` | [`form-controls.tsx`](../../frontend/components/ui/form-controls.tsx) |
| Surfaces | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `StatCard`, `Badge`, `Avatar`, `Skeleton`, `SkeletonGroup` | [`surface.tsx`](../../frontend/components/ui/surface.tsx) |
| Data | `Table`, `DataGrid`, `Tabs`, `Pagination`, `Stepper`, `Timeline`, `Breadcrumb` | [`data-display.tsx`](../../frontend/components/ui/data-display.tsx) |
| Overlays | `Dialog`, `Drawer`, `Tooltip`, `Popover`, `Menu`, `ConfirmDialog`, `ToastProvider`, `useToast`, `CommandPalette`, `useFocusTrap` | [`overlays.tsx`](../../frontend/components/ui/overlays.tsx) |
| States | `LoadingState`, `EmptyState`, `ErrorState`, `PartialState`, `StaleState`, `ForbiddenState`, `OfflineState`, `SkeletonState` | [`states.tsx`](../../frontend/components/ui/states.tsx), [`QueryState.tsx`](../../frontend/components/ui/QueryState.tsx) |

### Behavioural contract

- Buttons accept `loading` and announce `aria-busy`; disabled and loading
  controls never fire `onClick`.
- Form controls are always paired with `FormField`, which wires `label`,
  `aria-describedby` for hints and `role="alert"` for errors.
- Combobox and CommandPalette support ArrowUp/ArrowDown, Enter and Escape.
- Dialog, Drawer and CommandPalette share `useFocusTrap`: first focus moves
  inside, Tab cannot leave, Escape closes, and focus returns to the trigger.
- Toast is announced through `aria-live="polite"` and auto-dismisses.
- Tabs support ArrowLeft/ArrowRight and expose `role="tab"`/`role="tabpanel"`.

## App shell

| Surface | Responsibility |
|---|---|
| Sidebar | Grouped IA, active state, tenant/role, logout |
| Topbar | Mobile menu trigger, breadcrumb, global search, AI, notifications, theme, language, identity, user menu |
| MobileDrawer | Focus-trapped navigation on small screens |
| CommandPalette | Ctrl+K / Cmd+K search over navigation and actions |
| Breadcrumb | Longest-match path labels |

Role-restricted destinations are filtered from the sidebar and palette. A direct
URL renders `ForbiddenState` inside the shell.

## Screen states

| State | Component |
|---|---|
| loading | `LoadingState` / `SkeletonGroup` (announced, layout stable) |
| empty | `EmptyState` with an optional action |
| error | `ErrorState` with correlation ID |
| partial | `PartialState` |
| success | Content |
| forbidden | `ForbiddenState` / `ErrorState` 403 branch |
| offline | `OfflineState` + global `OfflineBanner` |
| stale | `StaleState` |

## Accessibility contract

- WCAG 2.1 AA, visible focus, skip link and landmarks.
- Every input has a programmatic label.
- Live updates use `aria-live`/`role="status"`; failures use `role="alert"`.
- Minimum target size 44 × 44 px where the layout allows; 200% zoom must not
  scroll horizontally.
- Colour never carries meaning alone.
- `prefers-reduced-motion` and `forced-colors` are handled in `globals.css`.
- The catalogue is scanned by axe in **light and dark** modes.

## Internationalisation

- Catalogs: `frontend/messages/en.json`, `frontend/messages/tr.json`.
- Helper: [`frontend/lib/i18n.ts`](../../frontend/lib/i18n.ts) (`t`, `plural`,
  `resolveLocale`, `formatNumberForLocale`, `formatDateTimeForLocale`).
- Client binding: [`frontend/lib/locale.tsx`](../../frontend/lib/locale.tsx)
  (`useI18n()`), cookie-backed (`awap_locale`), server-initialised.
- Interpolation uses `{name}`; plural selection uses `Intl.PluralRules`.
- Dates and numbers always go through `Intl.*` with `timeZone: "UTC"`.
- Parity and empty-value checks run in `lib/__tests__/i18nParity.test.ts`.
- Turkish long text is verified at 320 px; `.awap-truncate` + native `title`
  provide the fallback.

See [`phase-1-design-system.md`](phase-1-design-system.md) for the full delivery,
risk register and test matrix.

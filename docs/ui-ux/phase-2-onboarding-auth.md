# Phase 2 — Account creation, sign-in and tenant onboarding

**Status:** implemented on `feat/phase-2-onboarding-auth`
**Owner:** Frontend platform
**Related:** [`design-system.md`](design-system.md), [`phase-1-design-system.md`](phase-1-design-system.md), [`../accessibility.md`](../accessibility.md), [`../csp.md`](../csp.md)

## Goal

Make account creation, sign-in, tenant selection, invitation acceptance and the
first authenticated screen safe, understandable and never empty. The Flowable
"new user lands on an empty page" failure is explicitly prevented by the access
summary and next-action CTAs.

## Delivered

### Sign-in

- Brand/value panel + focused card, language and theme controls from `AuthShell`.
- Show/hide password, Caps Lock hint, password-manager-friendly autocomplete and
  `name` attributes.
- Enumeration-safe copy: 401, 403 and 404 all render
  `Email or password is incorrect.` with the same layout.
- `429` renders the Retry-After countdown and disables the submit button.
- `503` explains that sign-in is temporarily unavailable.
- `?reason=expired`, `?registered=1` and `?invited=1` render contextual banners.
- SSO buttons are visible placeholders with an explicit "not enabled yet" note.
- Safe `returnTo`: same-origin relative paths only; protocol-relative URLs,
  absolute URLs, backslash tricks, control characters and auth-loop paths fall
  back to `/dashboard` (`lib/redirect.ts`, risk R2-01).
- Login uses `router.replace` so Back does not return to the login screen (U2-09).

### Registration wizard

Four steps: **Workspace → Administrator → Security → Summary**.

- Slug validation + live `{slug}.awap.app` preview.
- Email format and 254-character limit before any request.
- Password policy: 12+ characters with upper, lower, digit and symbol; strength
  bar and per-rule checklist; confirm field; show/hide; Caps Lock hint.
- Required KVKK/GDPR consent checkbox (R2-06).
- Review summary with Edit links per step.
- `409` returns to the workspace step with a clear "slug taken" message.
- Submit lock prevents double requests (U2-07); create is disabled while pending.
- Success returns to sign-in with `?registered=1&tenant=...`.
- Email verification: the UI validates the address and explains that
  verification/security notices use it. The identity service does not expose a
  verification endpoint yet; the product copy does not claim a message was sent.
  This is tracked as a backend dependency for the identity provider phase.

### Tenant selection

- Single membership auto-selects with a full reload (cache isolation).
- Multiple memberships render cards with avatar, role badge and Continue.
- Choosing a tenant writes `awap_tenant` and replaces the location so the picker
  does not stay in the back stack.
- `403` renders `ForbiddenState`; `5xx` renders `ErrorState` with Retry;
  an empty list renders an explanation, Create tenant and Sign out CTAs
  (U2-11).
- The selected tenant survives a `returnTo` carried through RouteGuard.

### Invitation acceptance

- Public route `/invitations/accept?token=...`.
- Two modes: new account (full name + password + confirmation) or existing
  account (no password).
- Same password policy/strength and Caps Lock affordance as registration.
- `200` returns the joined tenant and sends the user to
  `/?invited=1&tenant=<slug>`.
- `400` distinguishes a missing password from an invalid token; `409` explains
  that the invitation is consumed/expired and offers "Request a new invitation"
  (U2-04). The backend returns `409` for consumed/expired tokens; the UI treats
  both `400` and `409` as terminal and actionable.
- Opening the route without a token is rejected without a request.

### First-login access summary

- Dashboard shows a dismissed-once summary with role, tenant, real pending-task
  and active-workflow counts, plus Open inbox / Start a workflow / Explore
  Copilot CTAs (T2-09, R2-07).
- Dismissal is stored in `localStorage` and read through
  `useSyncExternalStore`, so no hydration mismatch or empty landing page.

### Session visibility

- Login/refresh store the absolute expiry in `awap_session_expires_at`.
- Two minutes before expiry the shell shows a warning with a live countdown,
  Stay signed in and Sign out actions.
- Stay signed in uses the existing single-flight refresh; a failed refresh
  returns to `/?reason=expired` (U2-05). The warning is absent when no expiry
  cookie exists, so mocked/legacy sessions are unaffected.

### i18n

- Full `en`/`tr` catalogs for login, wizard, invitation, tenant picker,
  onboarding and session expiry; parity and empty-value tests remain in place.

## Backend contract notes

- `GET /api/v1/auth/tenants` currently returns **one** membership for the
  authenticated user. The UI is multi-tenant ready and is exercised with two
  memberships in deterministic tests; the backend list expansion is a separate
  service concern.
- `POST /api/v1/tenant-invitations/{token}/accept` returns `200` with the joined
  tenant; invalid tokens are `400`, consumed/expired invitations are `409`.
- Email verification has no identity-service endpoint today. The wizard
  validates the address and avoids false "verification sent" claims; the
  endpoint can be wired when the identity provider enables it.

## Risk register

| ID | Risk | Mitigation | Metric |
|---|---|---|---|
| R2-01 | Open redirect | `safeReturnTo` allowlist; unit + E2E | 0 accepted foreign returnTo |
| R2-02 | User enumeration | Same copy for 401/403/404; no status-specific UI | identical message |
| R2-03 | Brute force | 429 + Retry-After + disable submit | 429 surfaced |
| R2-04 | Password manager mismatch | standard autocomplete/name/id; no paste blocking | manual audit |
| R2-05 | Tenant mixing | `setActiveTenant` + full replace reload | 0 cross-tenant cache |
| R2-06 | Missing consent | required checkbox in wizard | 100% |
| R2-07 | Empty first screen | access summary + CTAs | empty landing = 0 |

## Test matrix

| ID | Level | Scenario | Implementation |
|---|---|---|---|
| T2-01 | E2E | Register → login | `e2e/register-onboarding.spec.ts`, `auth-journey.spec.ts` |
| T2-02 | E2E | Correct login + cookie | `e2e/auth-journey.spec.ts` |
| T2-03 | E2E | Wrong password inline, URL stable | `e2e/login-security.spec.ts` |
| T2-04 | E2E | 429 + Retry-After | `e2e/login-security.spec.ts` |
| T2-05 | E2E | Single tenant auto-select | `e2e/tenant-picker.spec.ts` |
| T2-06 | E2E | Multi-tenant picks correct `awap_tenant` | `e2e/tenant-picker.spec.ts` |
| T2-07 | E2E | 403 tenant | `e2e/tenant-picker.spec.ts` |
| T2-08 | E2E | Invitation accept (new + existing) | `e2e/invitation.spec.ts` |
| T2-09 | E2E | First-login access summary | `e2e/onboarding.spec.ts` |
| T2-10 | A11y | Form labels/ARIA | `e2e/accessibility.spec.ts` |
| T2-11 | Security | `returnTo=//evil.com` rejected | `lib/__tests__/redirect.test.ts`, `login-security.spec.ts` |
| T2-12 | Unit/E2E | Single refresh + expiry warning | `lib/__tests__/apiAuth.test.ts`, `session-timeout.spec.ts` |
| T2-13 | Visual | Login/register at 4 viewports | `e2e/visual-baseline.spec.ts` |

## Unhappy-path matrix

| ID | Scenario | Expected | Covered by |
|---|---|---|---|
| U2-01 | Empty fields | field error, no request | `register-onboarding.spec.ts` |
| U2-02 | Overlong email | rejected before request | `register-onboarding.spec.ts`, `validation.test.ts` |
| U2-03 | Duplicate slug | 409 → workspace step + message | `register-onboarding.spec.ts` |
| U2-04 | Expired/consumed invitation | actionable message + new-invite link | `invitation.spec.ts` |
| U2-05 | Refresh cancelled/failed | login with expired reason | `session-timeout.spec.ts` |
| U2-06 | Tenant API 500 | ErrorState + Retry | `tenant-picker.spec.ts` |
| U2-07 | Double submit | one request | `register-onboarding.spec.ts`, `login-security.spec.ts` |
| U2-08 | Caps Lock | warning | login/register/invitation |
| U2-09 | Back button | does not return to login | `router.replace` + tenant `location.replace` |
| U2-10 | 320px + 200% | usable, no horizontal scroll | `responsive.spec.ts`, shell test |
| U2-11 | No workspace access | explanation + admin/create CTA | `tenant-picker.spec.ts` |

## Definition of done

- [x] Register wizard with per-step validation, password policy, consent and summary.
- [x] Login card with brand, SSO placeholders, language/theme, error/rate-limit/expired states.
- [x] Tenant picker with auto-select, multi-tenant cards, empty/403/500 states.
- [x] Invitation acceptance for new and existing users.
- [x] Password strength + show/hide + Caps Lock.
- [x] Safe returnTo with unit and E2E proof.
- [x] First-login access summary with real counts and CTAs.
- [x] Visible session expiry warning and single-flight refresh behaviour.
- [x] `en`/`tr` parity; axe, console and visual gates green.
- [x] No empty first landing; no open redirect; no enumeration-specific copy.

## Commands

```bash
cd frontend
pnpm test
pnpm test:scripts
pnpm typecheck
pnpm lint
pnpm lint:inline
pnpm lint:colors
pnpm build && pnpm budget
pnpm test:e2e
```

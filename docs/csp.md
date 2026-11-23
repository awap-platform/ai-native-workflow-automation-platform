# Content Security Policy

Issue #183 introduces the per-request nonce policy; the UI/UX phase 0 hardens
it and adds the measurement and reporting needed to remove the last inline-style
exception. The policy is generated in [`frontend/proxy.ts`](../frontend/proxy.ts)
from the pure builder in [`frontend/lib/csp.ts`](../frontend/lib/csp.ts).

## Policy

```text
default-src 'self';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
script-src-attr 'none';
style-src 'self' 'nonce-<per-request>';
style-src-elem 'self' 'nonce-<per-request>';
style-src-attr 'none';            <- /workflows/designer scopes it to 'unsafe-inline'
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
upgrade-insecure-requests;        <- production only
report-uri /api/csp-report;
report-to csp-endpoint
```

- `unsafe-eval` is never emitted.
- `unsafe-inline` is never emitted. Inline `<script>` and `<style>` elements
  require the nonce; style attributes are forbidden entirely (issue 363).
- Next.js reads the CSP request header and applies the nonce to its bootstrap
  scripts. Application code can read `x-nonce` when it must render an inline
  tag.
- The root layout injects a nonce-carrying pre-paint theme script. It only
  toggles the `.dark` class and writes no inline styles, so it stays valid under
  the nonce policy and prevents a theme flash/hydration mismatch.
- `connect-src` is driven by `API_ORIGINS`, the same variable the backend CORS
  allowlist uses, so the two cannot drift.
- `frame-ancestors 'none'`, `frame-src 'none'`, `object-src 'none'`,
  `base-uri 'self'` and `form-action 'self'` stay locked down.

## Scoped designer style-attribute exception (issue 363)

Every React `style` attribute in application code was migrated to a token class
in `globals.css`, and the inline-style ratchet baseline is empty;
`pnpm lint:inline` fails on any new occurrence *or* a stale baseline entry.

One reviewed exception remains: `/workflows/designer`. React Flow applies
dynamic node/edge geometry as inline style attributes during SSR, which
`style-src-attr 'none'` would block. The proxy emits
`style-src-attr 'unsafe-inline'` **only** for that route; every other route keeps
`'none'`. The application's own edge-label geometry is applied through the
CSSOM, and the `X-CSP-Style-Attr-Exception` response header is gone.

## Reporting

| Header | Value |
|---|---|
| `Report-To` | `{"group":"csp-endpoint","max_age":10886400,"endpoints":[{"url":"/api/csp-report"}]}` |
| `Reporting-Endpoints` | `csp-endpoint="/api/csp-report"` |

[`frontend/app/api/csp-report/route.ts`](../frontend/app/api/csp-report/route.ts)
accepts both the legacy `csp-report` body and the Reporting API
`{ type: "csp-violation", body }` envelope.

- A valid report is **redacted**, recorded and answered `204`.
- Malformed JSON or an unrecognised body is answered `400` so a broken client is
  visible.
- `GET /api/csp-report` returns the deduplicated aggregate used by the admin
  dashboard at `/admin/csp`.
- Redaction strips query strings, fragments and credentials from
  `document-uri`, `referrer`, `blocked-uri` and `source-file`; `script-sample`
  is dropped entirely; cookies and authorization fields are never copied.
- Set `CSP_REPORT_COLLECTOR_URL` to forward the redacted report to an external
  collector. Reporting never breaks the response path.

### Collector limits

| Setting | Value |
|---|---|
| Dedupe window | 60 seconds |
| Retention | 24 hours |
| Maximum entries | 500 |
| Dashboard refresh | 15 seconds |

## Report-only rollout

`CSP_REPORT_ONLY=true` switches the response to
`Content-Security-Policy-Report-Only` while keeping the same directives and
reporting headers. Staging should run report-only first, triage the redacted
violations, then switch to enforce mode.

The Playwright suites assert the enforcing policy:

- [`frontend/e2e/security-headers.spec.ts`](../frontend/e2e/security-headers.spec.ts):
  nonce present, no unsafe script execution, scoped style exception, collector
  headers.
- [`frontend/e2e/console-errors.spec.ts`](../frontend/e2e/console-errors.spec.ts):
  zero `securitypolicyviolation` events on every route.
- [`frontend/e2e/csp-report.spec.ts`](../frontend/e2e/csp-report.spec.ts):
  `204`/`400` contract and the aggregated summary.

## Allowed third-party origins

There are no third-party origins by default. The only allowed connect origins
are the `API_ORIGINS` values. Any future third-party script must be:

1. loaded by a nonce-trusted Next.js script (`strict-dynamic`), or
2. added to an explicit allowlist with an owner, purpose and review date in this
   document.

## Deployment checks

- Staging/production must not set `CSP_REPORT_ONLY=true`.
- Every HTML response must carry either `Content-Security-Policy` or
  `Content-Security-Policy-Report-Only` with a nonce.
- `X-CSP-Style-Attr-Exception` must be `inactive` after the expiry date.
- A missing nonce fails the Playwright security assertion.
- `pnpm budget` must stay within 250 KB gzip per route.

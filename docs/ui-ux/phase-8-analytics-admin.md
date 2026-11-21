# Phase 8 — analytics and admin/IDM console

Phase 8 upgrades analytics from a read-only aggregate table into a filtered, drillable metric
surface, and adds the tenant administration, operate and audit consoles. English copy is used end
to end.

## Analytics

| Area | Behaviour |
|---|---|
| Single metric source | `GET /api/v1/analytics/overview` returns the advanced dashboard plus per-event totals folded by the server. Cards, chart and drill-down read that projection; the browser never sums a count. |
| Date range | `from`/`to` are ISO dates. A reversed range is rejected in the UI before a request and again by the API with `400`. The API caps the window at 366 days. |
| Granularity and grouping | `DAY`/`WEEK`/`MONTH` and `EVENT_TYPE`/`NODE`/`WORKFLOW` are sent to the server; every bucket and ranking is computed there. |
| Chart | A labelled SVG bar chart renders the server's `timeBuckets`. The same numbers are available in the totals and daily tables below it. |
| Drill-down | Each event total opens a cursor-free page of raw samples (`page`/`size`, max 50) with the server's `totalElements`. A raw-source failure returns `partial=true` and the page shows the partial banner instead of an empty-result claim. |
| Partial state | `dataCompleteness.rawEventsAvailable=false` enables the explicit partial banner; daily totals remain authoritative. |
| Export | `GET /api/v1/analytics/export` returns the bounded daily table as CSV. The UI confirms the action, retries a timeout once, and announces the retry and byte count. |

## Operational health

`GET /api/v1/admin/operate` supplies workflow, instance, task, outbox, dead-letter and
scheduled-pipeline cards. The pipeline list reports only durable signals:

- `outbox-relay` — the relay's last run, last success and consecutive failures.
- `notification-retry` — `IDLE` or `BACKLOG` from the number of retrying deliveries.

## Admin/IDM console

| Area | Behaviour |
|---|---|
| Users | Tenant users with their current role, creation time and a role select. |
| Role changes | A confirmation names the old and new role and states that the change is audited. The last administrator cannot be demoted (`409`); self-escalation is rejected (`403`). |
| Deleting a user | A destructive confirmation; the account is soft-deleted, audited, and the last administrator cannot be deleted. |
| Groups | Organization teams flattened with their member count. |
| Roles and permissions | The role/permission matrix is rendered from the server's role definitions; the browser never infers a grant. |
| Invitations | The list shows pending/accepted state, role, expiry and creation time. Creating one consumes a user quota seat and is audited. |
| Quota | Plan, user/workflow usage and AI-call ceiling, plus the metered usage table. An exhausted user quota returns `429` and the exact server message. |
| Tenant isolation | A tenant administrator requesting another tenant receives `403`. Only a system administrator may cross tenants. |

## Audit and break-glass

- The audit table pages the immutable tenant trail with the backend's opaque keyset cursor
  (newer/older page). A page-level filter narrows the rows currently displayed.
- Every privileged mutation is confirmed in the UI and written to the audit trail by the backend.
- The audit window can be exported as CSV (10,000-row ceiling, truncation reported). A timeout is
  retried once and announced.
- The break-glass panel renders the reviewed `settings/break-glass-log.json` snapshot served by the
  backend. An unreadable snapshot shows an explicit unavailable state; no exception is implied or
  hidden.

## Test map

| Test | Location |
|---|---|
| T8-01 analytics filter counts | [`app/(app)/__tests__/queryStatePages.test.tsx`](../../frontend/app/%28app%29/__tests__/queryStatePages.test.tsx), [`e2e/phase-8-analytics-admin.spec.ts`](../../frontend/e2e/phase-8-analytics-admin.spec.ts) |
| T8-02 drill-down list | same spec; `AnalyticsDrilldownServiceTest` |
| T8-03 role assignment audit | [`app/(app)/admin/__tests__/page.test.tsx`](../../frontend/app/%28app%29/admin/__tests__/page.test.tsx); `AdminConsoleServiceTest` audit capture |
| T8-04 privilege escalation 403 | same page test; `AdminConsoleServiceTest` self-escalation |
| T8-05 quota message | same page test; `AdminConsoleServiceTest` quota branch |
| T8-06 DLQ retry with confirmation and result | same page test; `e2e/phase-8-analytics-admin.spec.ts` |
| T8-07 table/chart axe 0 | `e2e/phase-8-analytics-admin.spec.ts`; [`e2e/accessibility.spec.ts`](../../frontend/e2e/accessibility.spec.ts) |
| T8-08 1M audit rows under 1s | [`AdminAuditPaginationITest`](../../backend/identity/src/test/java/com/awap/identity/infrastructure/AdminAuditPaginationITest.java) |
| T8-09 admin/analytics visual diff < 0.1% | [`e2e/visual-baseline.spec.ts`](../../frontend/e2e/visual-baseline.spec.ts) (`analytics`, `admin`, `operate`, `audit`) |
| T8-10 tenant B admin 403 | `AdminConsoleServiceTest`; `e2e/phase-8-analytics-admin.spec.ts` |
| U8-01…U8-08 | page tests, `export.test.ts`, `tenantSwitch.test.ts`, `AnalyticsDrilldownServiceTest`, `AdminConsoleServiceTest` |

## Honest limitations

- **Dead-letter definition.** The retryable DLQ view is the persisted terminal-failure notification
  delivery queue. Kafka dead-letter records are deliberately quarantined to an operator file and
  are never re-published, so they are not shown or retried here.
- **Scheduled jobs.** There is no generic scheduler registry. The job cards report the two
  pipelines that expose durable state (outbox relay and notification retry). A future heartbeat
  registry would be required to list every cron-style job.
- **Drill-down sampling.** The raw-event source is the bounded `analytics_event_samples` table. It
  contains identifiers and durations only; it is not an exhaustive event log and does not expose
  payloads.
- **Audit filtering.** The API supports keyset pagination only. The free-text filter applies to the
  page currently loaded; there is no server-side entity/action filter.
- **Export ceiling.** Audit export is capped at 10,000 rows and analytics export is bounded by the
  366-day dashboard window. A larger export must be narrowed deliberately.
- **Break-glass freshness.** The backend serves a build-time copy of the reviewed governance log. A
  drift test keeps it byte-identical, but a change to `settings/break-glass-log.json` requires a
  backend rebuild to appear in the console.
- **Visual baselines.** Analytics and audit filters use fixed query-string dates in the visual
  suite; the default range in normal use is the trailing seven days.

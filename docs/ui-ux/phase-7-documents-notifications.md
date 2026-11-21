# Phase 7 — documents, notifications and templates

Phase 7 completes the operational surface that surrounds the workflow engine: antivirus-scanned
documents, the notification inbox with delivery state, and tenant notification templates. English
copy is used end to end.

## Documents

| Area | Behaviour |
|---|---|
| Upload | The dropzone accepts a drag/drop or file-picker input, pre-validates the 500 MB limit and the PDF/DOCX/XLSX/PPTX/PNG/JPG/JPEG/TXT allow-list, then creates a quarantine slot and PUTs the bytes through XHR. |
| Progress | A native `<progress>` element and an `aria-live` text label report the transfer percentage. The cancel button aborts the XHR. |
| Interrupted cleanup | The presign call creates a pending version before the PUT starts. Cancel, network failure and leaving the page all call `DELETE /api/v1/documents/versions/{versionId}` and state whether the pending row was actually removed. |
| Scan timeline | Every `scan-status` SSE event observed by this tab is appended to a per-file timeline with its status, timestamp and detail. |
| INFECTED | A `role="alert"` banner names the rejected file and keeps download disabled. The row also says the file is blocked. |
| SCAN_FAILED | The row shows the last error and a `Retry scan` action. The action calls `POST /api/v1/documents/{fileId}/retry-scan`, which only accepts a failed scan, resets the attempt budget and re-queues the file as `QUARANTINED`. |
| Download gating | Download is enabled only when `scanStatus === "PROMOTED"` and `downloadable === true`; the URL is requested just in time. |
| Versions | Each row expands to `GET /api/v1/documents/{fileId}/versions`; the list is loaded lazily and shows lifecycle, scan status and creation time. |
| Archive | `POST /api/v1/documents/versions/{versionId}/archive` keeps the row for retention. An already archived version shows a disabled `Archived` button. |
| Live status | The tenant SSE stream updates rows and timeline in place. When SSE is unavailable or reconnects are exhausted, the page polls `GET /api/v1/documents` every five seconds and says so. |

## Notifications

| Area | Behaviour |
|---|---|
| Inbox | Tenant-scoped list with unread badge, read/unread toggle and the delivery status, attempts, next retry time and last error. |
| Filters | Read state, channel, delivery status and a recipient/template search. The visible/total count is an `aria-live` status. |
| Bulk actions | Select individual rows or all filtered rows, then mark read or unread. The API has idempotent per-id PATCH endpoints, so the action fans out; a partial failure is reported as `N updated, M failed`. |
| Duplicate delivery | Duplicate notification requests are de-duplicated by the backend delivery key. The inbox shows one row per delivery, so a suppressed duplicate never appears twice. |
| Suppression | `GET /api/v1/notifications/suppressions` lists blocked recipients with channel, reason and timestamp. A suppressed recipient is never contacted again on that channel and is never retried. |

## Templates

| Area | Behaviour |
|---|---|
| Variables | The editor extracts `{{placeholder}}` names, lists them as chips and validates that every placeholder has a supplied variable. |
| Empty variables | A supplied-but-empty value renders a warning instead of a hard error, so an operator can preview before filling it in. |
| Preview | `Preview` renders the draft with the supplied variables; `Preview saved` renders the stored key/locale, which is how an unknown template becomes visible. |
| Locale | `en`, `tr` and regional forms such as `en-US` are accepted; anything else is rejected before the API call. |
| Version validation | Saves send the current `expectedVersion`. A concurrent edit is rejected and explained instead of overwriting it. |
| Long templates | The 1 MiB UTF-8 body limit is checked in the browser before preview or save. |
| Archive/activate | Archived templates fall back to the built-in default; activation restores the tenant override. |

## Test map

| Test | Location |
|---|---|
| T7-01 upload → PROMOTED states | [`e2e/phase-7-documents-notifications.spec.ts`](../../frontend/e2e/phase-7-documents-notifications.spec.ts) `T7-01`, `useDocumentScanStatus` history test |
| T7-02 INFECTED alert + blocked download | same spec `T7-02`; `frontend/app/(app)/documents/__tests__/page.test.tsx` |
| T7-03 413/415 | same spec `T7-03`; [`lib/__tests__/documentUpload.test.ts`](../../frontend/lib/__tests__/documentUpload.test.ts) |
| T7-04 version/archive list | same spec `T7-04`; documents page unit test |
| T7-05 read decrements count | same spec `T7-05`; [`NotificationInbox.test.tsx`](../../frontend/components/notifications/__tests__/NotificationInbox.test.tsx) |
| T7-06 template preview variables | same spec `T7-06`; [`NotificationTemplateEditor.test.tsx`](../../frontend/components/notifications/__tests__/NotificationTemplateEditor.test.tsx) |
| T7-07 template validation unit | `NotificationTemplateEditor.test.tsx`, `notificationTemplates` helpers |
| T7-08 aria-live alert axe 0 | same spec `T7-02` AxeBuilder assertion; `accessibility.spec.ts` documents screen |
| T7-09 SSE drop → polling | same spec `T7-09`; `useDocumentScanStatus.test.tsx` reconnect-budget test |
| T7-10 timeline/inbox visual diff < 0.1% | [`visual-baseline.spec.ts`](../../frontend/e2e/visual-baseline.spec.ts) `documents`, `notifications` screens at 0.1% |

## Honest limitations

- The scan timeline is **session-observed**. The backend exposes the current scan projection and live
  events, not a persisted transition-history endpoint, so a reload keeps the current status but loses
  earlier timeline entries.
- Uploads restart from zero after a cancel; there is no resumable transfer. The pending version is
  removed, and the operator chooses the file again.
- Manual retry only exists for `SCAN_FAILED`. `INFECTED` is terminal and is never re-scanned, and a
  file already past the scheduler's automatic retry budget can still be re-queued by the operator.
- Bulk read/unread is a client-side fan-out over idempotent per-notification PATCH requests. There is
  no atomic multi-id endpoint, and a partial network failure is reported rather than rolled back.
- The suppression view is read-only. There is no un-suppress endpoint; a bounce or complaint stays
  blocked for that channel and recipient.
- Template preview renders placeholders as plain text. The editor never injects markup, and provider
  specific rendering/escaping remains the provider adapter's responsibility.
- The template list shows the current revision per key/locale. The audited revision endpoint exists,
  but this phase does not add a full revision browser or restore action.
- Polling fallback runs every five seconds. It is deliberately slower than SSE and does not attempt
  to replay missed events.

# Phase 4 — Workflow catalogue and instance monitoring

Phase 4 turns `/workflows` into a searchable catalogue and `/instances` into an operator monitor
with a deep-linkable instance 360 view. Both pages are driven by the existing engine contracts plus
additive response fields.

## Delivered

| Area | What shipped |
|---|---|
| Catalogue | Cards/table hybrid with name search, status filter, updated/name/version sort and pagination |
| Catalogue metadata | Status, version, owner, last update and live running/total instance counts per definition |
| Start dialog | JSON validation, parsed-field preview, per-attempt idempotency key, unpublished/conflict/forbidden copy |
| Instance list | State filter, search, sort, pagination, polling and CSV export |
| Instance detail | Node timeline from execution logs, variables, redacted log table, saga steps |
| Actions | Retry, pause, resume, cancel, replay (dry-run then apply), saga compensation and step retry |
| Safety | Replay apply is gated on a `MATCHED` dry-run; log payloads redact emails and long numbers |
| Deep links | `/instances/{id}` and `/workflows` → `/instances?workflow=…`; tenant checks surface as 403/404 |

## Backend contract

| Endpoint | Use |
|---|---|
| `GET /api/v1/workflow-definitions` | Catalogue rows (now includes `createdAt`, `updatedAt`, `createdBy`) |
| `GET /api/v1/workflow-instances` | Monitor list; optional `limit`/`offset` plus `X-Total-Count` |
| `GET /api/v1/workflow-instances/{id}` | Detail (now includes `updatedAt`, `parentInstanceId`) |
| `GET /api/v1/workflow-instances/{id}/logs` | Timeline source |
| `GET /api/v1/workflow-instances/{id}/saga` | Saga summary and steps |
| `POST /{id}/retry` · `pause` · `resume` · `cancel` · `recover` | Operator transitions |
| `POST /{id}/replay?dryRun=true` · `POST /{id}/replay` | Projection report, then reference replay |
| `POST /{id}/saga/compensate` · `/{stepId}/retry` | Manual compensation |

The monitor reads the tenant list once and paginates client-side so counts and state filters stay
consistent without a request per keystroke; the server pagination is available for integrations and
covered by controller tests. The 10k-instance pipeline is asserted under 500 ms in
[`workflowCatalogue.test.ts`](../../frontend/lib/__tests__/workflowCatalogue.test.ts).

## Risk mitigations

| Risk | Mitigation |
|---|---|
| R4-01 wrong start | Start opens from the row, shows a parsed preview and generated idempotency key |
| R4-02 large list | Pagination plus a single tenant read; 10k filter/sort/page under 500 ms (unit) |
| R4-03 wrong state | The engine response replaces the cached instance; no local state machine |
| R4-04 replay side effects | Dry-run first; Apply is disabled unless `MATCHED`, with explicit confirmation |
| R4-05 PII in logs | `redactPayload` masks emails and 9+ digit numbers before render/export |
| R4-06 deep-link IDOR | API tenant scoping; 403 and 404 render distinct screens |

## Tests

- Unit: [`workflowCatalogue.test.ts`](../../frontend/lib/__tests__/workflowCatalogue.test.ts) —
  filters, sorts, stats, pagination, 10k budget, timeline grouping, saga summary, redaction, context
  validation, idempotency keys and CSV export.
- E2E: [`workflow-instance.spec.ts`](../../frontend/e2e/workflow-instance.spec.ts) — catalogue
  search/filter/table, invalid context, start payload, unpublished and 409 copy, list filter/export,
  timeline/variables/saga, retry action, matched vs divergent replay, deleted instance.
- Backend: `WorkflowInstanceReplayWebMvcTest` covers the paginated list (with and without a limit,
  beyond the end) and the DTO shape.
- Accessibility/console/visual suites include the catalogue, monitor and the new `instance-detail`
  screen (four viewports).

## Honest limitations

- The execution log carries no correlation ID; the detail shows the instance reference (and the
  correlation ID of any failed operator action) rather than inventing one.
- The monitor polls every five seconds because the engine has no SSE stream for instance state;
  the detail refreshes after each operator action instead of polling.
- Compensation and replay are operator actions with confirmations; they cannot be undone from the UI.

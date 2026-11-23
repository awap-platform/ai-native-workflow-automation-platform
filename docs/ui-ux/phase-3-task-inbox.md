# Phase 3 — Task inbox and work item 360

Phase 3 turns `/tasks` into a two-pane work item inbox: a filterable, searchable,
sortable list on the left and a 360° work item on the right. Every decision the
task API supports is available from the detail panel, each one confirmed, guarded
against double submission and translated into human language when the server
refuses it.

## Scope delivered

| Area | What shipped |
|---|---|
| Split-pane layout | [`TaskInbox`](../../frontend/components/tasks/TaskInbox.tsx) renders the list and the work item side by side from `lg` up; below `lg` a row opens `/tasks/[id]` |
| Filters | Open, completed, assigned to me, unassigned and overdue, with live counts |
| Search and sort | Title/description/status search; SLA, newest, title and status sorting |
| Saved views | Named filter/search/sort triples persisted in the browser (max eight) |
| Work item 360 | Context, decision, history, attachments and variables tabs |
| Actions | Approve, reject, complete, claim, assign/reassign and escalate |
| SLA | Server-provided deadline rendered as due/overdue with a 15 minute warning boundary |
| Idempotency | A ref lock plus the mutation's pending state mean one request per decision |
| Conflicts | `409` becomes "This work item changed while you were reading it" with a reload action |
| Bulk actions | Approve, complete, claim and assign with per-item results and a partial report |
| Keyboard | `J`/`K` move, `Enter` focuses the detail, `A` approves, `R` rejects |
| Mobile | Separate `/tasks/[id]` route instead of a squeezed split pane |

## Backend contract

The inbox is built on the existing task API and one additive field set:

| Endpoint | Use |
|---|---|
| `GET /api/v1/tasks` | Tenant inbox list |
| `GET /api/v1/tasks/mine` | "Assigned to me" view without guessing the user id |
| `POST /api/v1/tasks/{id}/approve` | Approve with an optional comment |
| `POST /api/v1/tasks/{id}/reject` | Reject; the UI requires a comment |
| `POST /api/v1/tasks/{id}/complete` | Complete an assigned or in-progress task |
| `POST /api/v1/tasks/{id}/claim` | Claim an unassigned task |
| `POST /api/v1/tasks/{id}/assign` | Assign or reassign |
| `POST /api/v1/tasks/{id}/escalate` | Reassign and restart the one-hour SLA window (added in this phase) |

`TaskResponse` now also returns `taskType`, `escalated`, `escalateAt`,
`createdAt`, `updatedAt` and `completedAt`. `escalateAt` is the only SLA source:
the client never invents a deadline, which keeps the countdown honest when a
workstation clock is wrong.

Invalid lifecycle transitions already return `409` from `TaskService`, and the
mutating endpoints are tenant-scoped and permission-checked, so a foreign task
surfaces as `403`/`404` rather than leaking data.

## Risk mitigations

| Risk | Mitigation in this phase |
|---|---|
| R3-01 double approval | `submitting` ref plus `isPending`; unit test double-clicks the confirmation and asserts one call |
| R3-02 wrong decision | Confirmation copy states the consequence; reject requires a comment |
| R3-03 IDOR | Tenant header and `TASK_*` authorities stay server-side; the UI renders `403` as a permission failure |
| R3-04 large lists | `.awap-task-row` uses `content-visibility: auto`; the 1000-row filter test asserts the interaction stays under one second |
| R3-05 wrong SLA | Deadline comes from the server; `lib/serverClock.ts` derives skew from the HTTP `Date` header so the countdown uses server time |
| R3-06 lost comment | Drafts autosave per task in `localStorage` and clear on success; Turkish text and emoji round-trip in tests |
| R3-07 unusable mobile split | `/tasks` is list-only below `lg`; the work item lives at `/tasks/[id]` |
| R3-08 row label overlaps the title (issue #357) | `Checkbox` gained a `hideLabel` mode that keeps `aria-label` on the input and renders no visible label; `.awap-task-row` keeps the checkbox at `flex: 0 0 auto` while the title column has `min-width: 0`, so the badge and SLA cannot be pushed under the checkbox |

## Test matrix

| ID | Where |
|---|---|
| T3-01 filters | [`e2e/task-inbox.spec.ts`](../../frontend/e2e/task-inbox.spec.ts) — filter and search rows |
| T3-02 select → detail | Same file — heading, context and decision form |
| T3-03 approve | Same file — one request, success toast, row moves to completed |
| T3-04 reject needs a comment | Same file and [`TaskWorkItem.test.tsx`](../../frontend/components/tasks/__tests__/TaskWorkItem.test.tsx) |
| T3-05 double click | Unit test double-clicks confirm; E2E double-clicks with a delayed response |
| T3-06 409 | Unit and E2E assert the human conflict message and reload action |
| T3-07 tenant isolation | E2E reloads as `tenant-b` and sees zero rows |
| T3-08 keyboard decision | E2E drives `J`/`K`/`A` and asserts the confirmation dialog |
| T3-09 1000 tasks | E2E asserts 1000 rows and a sub-second filter interaction |
| T3-10 visual | `task-detail` added to the visual baseline set (four viewports) |
| T3-11 SLA boundary | [`lib/__tests__/taskInbox.test.ts`](../../frontend/lib/__tests__/taskInbox.test.ts) — exact 15 minute boundary and one millisecond past it |
| T3-12 escalate | E2E asserts the new assignee payload and the restarted deadline |
| T3-13 row geometry (issue #357) | E2E asserts the checkbox, title, badge and SLA bounding boxes do not intersect and that no visible "Select …" text is rendered |
| T3-14 long-title overflow (issue #357) | Unit test asserts the hidden-label contract and row shape; E2E asserts a 500-character title creates no horizontal scroll at 320 px |

Unhappy paths covered: someone else's task (`403`), removed task (`404`), two
tabs (`409`), timeout (`5xx` retry copy), offline banner, long comment limit
(2000 characters), Turkish/emoji drafts, revoked permission and bulk partial
failure.

## Honest limitations

- The task contract has no separate comment, attachment or audit stream. The
  history and variables tabs show exactly the fields the server records, and the
  attachments tab states that none are attached instead of inventing files.
- Bulk actions call the per-task endpoints in order and report each failure; there
  is no server-side bulk endpoint to pretend otherwise.
- Assignee selection takes a user id because the task API has no member lookup
  endpoint; the hint says so.

## Local commands

```bash
cd frontend
pnpm jest lib/__tests__/taskInbox.test.ts lib/__tests__/taskSupport.test.ts
pnpm jest --runTestsByPath components/tasks/__tests__/TaskWorkItem.test.tsx
pnpm playwright test e2e/task-inbox.spec.ts
```

All suites run against mocked task contracts; the production-stack gates
(`console-errors`, `accessibility`, `responsive`, `visual-baseline`) include the
new inbox and work item screens.

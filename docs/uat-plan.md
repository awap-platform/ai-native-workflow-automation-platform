# User acceptance test plan

**Status:** plan written, **not executed**. No session, participant or evidence
has been recorded. This page defines exactly what to run and what to attach so
the result cannot be inferred from a green CI run.

**Threshold:** at least 9 of 10 tasks pass (**≥ 90%**). A failed task is triaged
as a defect, a documentation gap or a test-script problem; a severity-1 defect
blocks the release regardless of the pass ratio.

**Executable gate (issue 365):** the runbook is [`uat/README.md`](uat/README.md),
results follow [`uat/results.schema.json`](uat/results.schema.json), and
`cd frontend && pnpm uat:check ../../docs/uat/results.json` fails until there are
at least ten consented participants, every task was executed ten times, success
is ≥ 90%, SUS is ≥ 80, no P0 finding is open and no cross-tenant observation was
recorded. The gate itself is unit-tested in
[`../frontend/scripts/test/uat-results.test.mjs`](../frontend/scripts/test/uat-results.test.mjs).

## Participants and environment

| Item | Value |
|---|---|
| Participants | At least 3, covering an approver, an operations user and a tenant admin |
| Environment | Staging deployment at the release candidate tag, seeded tenant, email sandbox |
| Browsers | Chrome (desktop), Safari (macOS and iOS), Firefox (desktop) |
| Assistive tech | One NVDA pass and one VoiceOver pass (see [`accessibility.md`](accessibility.md)) |
| Data | Synthetic only; no production tenant data |

## Tasks

| ID | Persona | Task | Steps | Pass criterion | Evidence to attach |
|---|---|---|---|---|---|
| UAT-01 | Approver | Sign in and reach the inbox | Sign in with the seeded tenant, open the inbox | Dashboard and inbox render within 3 s; no console error | Screen recording + browser console screenshot |
| UAT-02 | Approver | Decide a task | Open a task, approve with a comment; open the next task and reject without a comment | Approve succeeds; reject requires a comment and explains why | Screenshot of both confirmations |
| UAT-03 | Approver | Use keyboard only | Reach the inbox with Tab/Shift+Tab, move with `J`/`K`, open with `Enter`, approve with `A` | Entire decision completes without a mouse; focus is always visible | Recording of the keyboard walk |
| UAT-04 | Operations | Start a published workflow | Open the catalogue, start a workflow, open the instance monitor | Instance appears with a running state; timeline shows the start node | Screenshot of the instance timeline |
| UAT-05 | Operations | Investigate a failure | Open a failed instance, inspect logs and saga compensation | Redacted logs and compensation status are readable; no unrelated tenant data | Screenshot of the detail tabs |
| UAT-06 | Operations | Handle a document | Upload a PDF, wait for scan to reach promoted, download it | Status transitions are announced; download stays disabled until promoted | Screen recording + live-region observation notes |
| UAT-07 | Tenant admin | Manage identity | Invite a user, change a role, review the audit log | Invitation and role change appear in the audit log with actor and timestamp | Screenshot of the audit rows |
| UAT-08 | Tenant admin | Read analytics | Open analytics for a fixed range, drill into one event type | Aggregates and drilldown match the seeded data; empty state is explicit | Screenshot of dashboard and drilldown |
| UAT-09 | Approver | Ask the Copilot | Ask a knowledge question and a task-summary question | Answer cites sources or explicitly says no answer; no fabricated citation; budget shown | Screenshot of the answer and citations |
| UAT-10 | All | Degraded and accessible use | Rotate to 320 px/200% zoom, enable reduced motion, enable high contrast | No horizontal scroll; motion stops; controls keep visible borders; screen reader announces page landmarks | Screenshots per condition + NVDA/VoiceOver notes |

## Execution record template

| Field | Value |
|---|---|
| Release candidate tag | |
| Date and environment | |
| Participant and role | |
| Browser and assistive technology | |
| Tasks passed / total | |
| Ratio (≥ 90% required) | |
| Defects (id, severity, owner) | |
| Decision (go / no-go) | |

## Result

**Not executed.** The table above is the required evidence. A release decision
must reference the completed record; a green CI run is not a substitute for
UAT.

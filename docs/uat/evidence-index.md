# UAT evidence index (issue 365)

Two tracks, recorded separately. The automated track is executed and evidenced;
the human panel is still a template and must not be reported as done.

## Track A — automated persona UAT (executed)

| Field | Value |
|---|---|
| Release candidate | commit `9404740` on `main` (build from `pnpm build`) |
| Environment | production build served on `http://localhost:3100`, deterministic mocked API, Chromium |
| Participants | 10 scripted personas: 2 approver, 2 operations, 2 tenant-admin, 2 employee, 2 designer |
| Session date | 2026-11-23 |
| Results file | [`results.automated.json`](results.automated.json) |
| Run log | [`runs/2026-11-23-automated.md`](runs/2026-11-23-automated.md) |
| Gate | `pnpm uat:check:automated` → all objective checks PASS, SUS `PEND` |
| Reproduce | `pnpm build && pnpm start -p 3100 &` then `E2E_EXTERNAL_STACK=1 E2E_BASE_URL=http://localhost:3100 pnpm uat:run` |

### Task evidence

| Task | Scenario | Sessions | Passed | Evidence |
|---|---|---|---|---|
| UAT-01 | Sign in and reach the inbox | 10 | 10 | `e2e/task-inbox.spec.ts` (filters narrow the inbox) |
| UAT-02 | Decide a task | 10 | 10 | `e2e/task-inbox.spec.ts` (approving sends one request) |
| UAT-03 | Keyboard-only decision | 10 | 10 | `e2e/task-inbox.spec.ts` (keyboard J/K) |
| UAT-04 | Start a published workflow | 10 | 10 | `e2e/workflow-instance.spec.ts` (starting a workflow) |
| UAT-05 | Investigate a failure | 10 | 10 | `e2e/workflow-instance.spec.ts` (node timeline, redacted logs, saga) |
| UAT-06 | Upload and follow the scan | 10 | 10 | `e2e/phase-7-documents-notifications.spec.ts` (T7-01) |
| UAT-07 | Manage identity | 10 | 10 | `e2e/phase-8-analytics-admin.spec.ts` (T8-03/T8-05) |
| UAT-08 | Read analytics | 10 | 10 | `e2e/phase-8-analytics-admin.spec.ts` (T8-01/U8-07) |
| UAT-09 | Ask the Copilot | 10 | 10 | `e2e/phase-9-ai-copilot.spec.ts` (T9-01/02/05) |
| UAT-10 | Degraded and accessible use | 10 | 10 | `e2e/responsive.spec.ts` (200% zoom) |

### Gate and decision (automated track)

| Field | Value |
|---|---|
| Task success rate | 100 / 100 = **100%** (≥ 90% required) |
| Critical-path time | 1.1 s slowest (T8 limit 120 s) |
| Tenant-isolation probe | 2 / 2 passed; cross-tenant observations **0** |
| Open P0 findings | **0** |
| Findings raised | **0** |
| Decision | automated track **pass** |

### Findings and triage

None were raised by the automated run. The runner creates a triaged P1 finding per
failing task automatically, so any future failure lands with an owner (`frontend`)
instead of being silently re-run.

## Track B — human panel (not executed)

Replace every `<...>` below only after the sessions run.

| Field | Value |
|---|---|
| Release candidate tag | `<tag>` |
| Environment and region | `<staging ...>` |
| Seed data version | `<seed commit or id>` |
| Session dates | `<date range>` |
| Moderator | `<name>` |
| Consent + retention record | `<link>` |

| Participant | Persona | Consent recorded | Browser / AT | Sessions |
|---|---|---|---|---|
| `<P1>` | `<approver>` | `<yes/no>` | `<Chrome / NVDA>` | `<UAT-01…>` |

| Task | Recorded evidence link | Outcome | Time on task | Notes |
|---|---|---|---|---|
| UAT-01 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-02 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-03 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-04 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-05 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-06 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-07 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-08 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-09 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-10 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |

| Field | Value |
|---|---|
| Results file | `<docs/uat/results.json>` |
| SUS average | `<xx>` (≥ 80 required) |
| Qualitative findings | `<F1 …>` |
| Decision | `<go / no-go>` |
| Sign-off | `<product + QA + security>` |

The human panel is **not executed**. The full gate
(`pnpm uat:check ../../docs/uat/results.json`) stays red until SUS and consent
records exist.

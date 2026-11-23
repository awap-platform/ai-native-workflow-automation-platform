# UAT execution pack (issue 365)

The ten-task UAT has two tracks. The **automated persona track has been executed**
and its evidence is committed; the **human panel** is still required for the
subjective measures (SUS, qualitative notes, assistive-technology observations)
and is tracked as an explicit open item rather than inferred from automation.

| Track | What it measures | Status |
|---|---|---|
| Automated persona UAT | task success, time on task, error rate, tenant isolation, degraded-mode behaviour | **executed 2026-11-23** |
| Human panel | SUS score, qualitative findings, NVDA/VoiceOver notes, consent | not executed — instrument ready |

## Artifacts

| Artifact | Purpose |
|---|---|
| [`../uat-plan.md`](../uat-plan.md) | The ten tasks, personas, pass criteria and evidence list |
| [`../../frontend/scripts/uat/uat-plan.mjs`](../../frontend/scripts/uat/uat-plan.mjs) | Executable binding of each task to the maintained Playwright scenario |
| [`../../frontend/scripts/uat/run-uat.mjs`](../../frontend/scripts/uat/run-uat.mjs) | Executes every task once per participant and writes the results file |
| [`results.automated.json`](results.automated.json) | Committed result of the executed run |
| [`results.automated.schema.json`](results.automated.schema.json) | Shape of the automated results file |
| [`runs/2026-11-23-automated.md`](runs/2026-11-23-automated.md) | Per-task run log for the executed run |
| [`results.schema.json`](results.schema.json) | Shape of the *human* results file (includes SUS) |
| [`results.example.json`](results.example.json) | Clearly-marked template; never evidence |
| [`evidence-index.md`](evidence-index.md) | Evidence index for both tracks |
| [`../../frontend/scripts/uat/check-uat-results.mjs`](../../frontend/scripts/uat/check-uat-results.mjs) | Acceptance gate for both scopes |
| [`../../frontend/scripts/test/uat-results.test.mjs`](../../frontend/scripts/test/uat-results.test.mjs) | Unit tests for the gate itself |
| [`../../frontend/scripts/test/uat-evidence.test.mjs`](../../frontend/scripts/test/uat-evidence.test.mjs) | Keeps the committed evidence passing the gate |

## Automated track

Each task in the plan is bound to the scenario that already exercises it
(`e2e/task-inbox.spec.ts`, `e2e/workflow-instance.spec.ts`,
`e2e/phase-7-documents-notifications.spec.ts`, `e2e/phase-8-analytics-admin.spec.ts`,
`e2e/phase-9-ai-copilot.spec.ts`, `e2e/responsive.spec.ts`). Duplicating the flows
in a second harness would drift from the product tests and would need its own
selectors, so the UAT points at the maintained scenarios and adds the measurement.

### Reproduce the run

```bash
cd frontend
pnpm build
pnpm start -p 3100 &          # production build; `pnpm dev` is not equivalent (StrictMode
                              # double-invokes effects, which changes upload state)
E2E_EXTERNAL_STACK=1 E2E_BASE_URL=http://localhost:3100 pnpm uat:run
```

The runner executes every task once per participant (default 10 participants),
records the real pass/fail and duration of each browser run, runs the
tenant-isolation probe, and writes both the results file and a dated run log.

### Gate

```bash
cd frontend
pnpm uat:check:automated      # objective criteria, uses results.automated.json
```

It fails unless all of the following hold:

- at least ten participants;
- every task executed by ten distinct participants (100 sessions);
- task success rate ≥ 90%;
- no open P0 finding;
- zero cross-tenant observations;
- every critical-path task under two minutes.

SUS is reported as `pending-human-panel`. It is **not** counted as a pass: the
automated gate prints `PEND`, and the full gate below still requires it.

### Executed result — commit `9404740`, 2026-11-23

| Measure | Value | Threshold |
|---|---|---|
| Participants | 10 (approver, operations, tenant-admin, employee, designer) | ≥ 10 |
| Sessions | 100 | 100 |
| Task success | 100 / 100 (100%) | ≥ 90% |
| Critical-path time | 1.1 s slowest | < 120 s |
| Cross-tenant observations | 0 | 0 |
| Open P0 findings | 0 | 0 |
| Findings raised | 0 | triaged |
| SUS | pending human panel | ≥ 80 |

## Human panel

The subjective track cannot be produced by automation, and a green CI run is not a
substitute for it.

### Before the first session

1. Freeze a release-candidate tag and build the production artifact.
2. Seed a dedicated staging tenant with synthetic data covering every task. Confirm
   tenant B sees none of tenant A's data.
3. Recruit at least ten participants across approver, operations, tenant-admin,
   employee and designer personas.
4. Record written consent for recording and note the retention policy. Participants
   may withdraw and have their data removed.

### During each session

- Follow the scripted task order, using neutral prompts only.
- Record task success, time on task, errors, the SUS instrument and the
  accessibility path used.
- Capture screenshots or short recordings for each task, plus the browser console.
- Do not coach; if a participant is blocked, record the failure and the root cause.
- Never use production tenant data and never record personal data.

### After the sessions

1. Fill [`evidence-index.md`](evidence-index.md) with links to the evidence.
2. Write the human results file matching [`results.schema.json`](results.schema.json),
   merging the automated sessions with the measured SUS scores.
3. Run the full gate:

   ```bash
   cd frontend
   pnpm uat:check ../../docs/uat/results.json
   ```

4. Triage every finding into an issue with an owner. Re-test fixed P0/P1 findings.
5. Link the results file, evidence index and triage issues from the release ticket.

## Honest status

The objective criteria are measured and green. The human panel — SUS, consent
records and qualitative observations — has not run, and this pack does not claim it
has. Until it does, the programme is not operationally closed on UAT, even though
task success, timing, isolation and error behaviour are evidenced.

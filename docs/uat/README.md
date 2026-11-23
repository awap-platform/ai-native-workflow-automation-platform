# UAT execution pack (issue 365)

This pack makes the UI/UX UAT executable and its result auditable. It does **not** claim that the
sessions have run: the programme completion map keeps UAT unchecked until real participants produce
the evidence described here.

## What exists

| Artifact | Purpose |
|---|---|
| [`../uat-plan.md`](../uat-plan.md) | The ten tasks, personas, pass criteria and evidence list |
| [`results.schema.json`](results.schema.json) | Shape of the machine-readable results file |
| [`results.example.json`](results.example.json) | Clearly-marked template; never evidence |
| [`evidence-index.md`](evidence-index.md) | Human sign-off index for recordings, notes and defects |
| [`../../frontend/scripts/uat/check-uat-results.mjs`](../../frontend/scripts/uat/check-uat-results.mjs) | Executable acceptance gate |
| [`../../frontend/scripts/test/uat-results.test.mjs`](../../frontend/scripts/test/uat-results.test.mjs) | Unit tests for the gate itself |

## Before the first session

1. Freeze a release-candidate tag and build the production artifact.
2. Seed a dedicated staging tenant with synthetic data covering every task. Confirm tenant B sees
   none of tenant A's data.
3. Recruit at least ten participants across approver, operations, tenant-admin, employee and
   designer personas.
4. Record written consent for recording and note the retention policy. Participants may withdraw
   and have their data removed.

## During each session

- Follow the scripted task order, using neutral prompts only.
- Record task success, time on task, errors, and any accessibility path used.
- Capture screenshots or short recordings for each task, plus the browser console.
- Do not coach; if a participant is blocked, record the failure and the root cause.
- Never use production tenant data and never record personal data.

## After the sessions

1. Fill [`evidence-index.md`](evidence-index.md) with links to the evidence.
2. Write the machine-readable results file matching [`results.schema.json`](results.schema.json).
3. Run the gate from the frontend directory:

   ```bash
   cd frontend
   pnpm uat:check ../../docs/uat/results.json
   ```

   The command fails unless all of the following are true:
   - at least ten participants, all consented;
   - all ten tasks executed by ten distinct participants;
   - task success rate >= 90%;
   - SUS average >= 80;
   - no open P0 finding;
   - zero cross-tenant observations.

4. Triage every finding into an issue with an owner. Re-test fixed P0/P1 findings.
5. Link the results file, evidence index and triage issues from the release ticket.
6. Only then may [`../ui-ux/programme-completion.md`](../ui-ux/programme-completion.md) mark UAT
   complete.

## Honest status

At the time of this change no session has been run. The gate is ready, tested, and will stay red
until real evidence exists; a green CI run is not a substitute for UAT.

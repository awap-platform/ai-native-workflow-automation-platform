/**
 * Executable UAT plan (issue 365).
 *
 * The ten tasks from docs/uat-plan.md are bound to the deterministic Playwright
 * scenarios that exercise them. Binding the plan to real tests is what makes the
 * UAT measurable: every task is executed, timed and scored instead of being
 * asserted in prose.
 *
 * A task is *not* a hand-written duplicate of the scenario. Duplicating the flow
 * would drift from the product tests and would need its own locators; pointing at
 * the maintained scenario keeps the UAT honest about what the product does today.
 *
 * Each task runs once per participant, so ten participants produce one hundred
 * recorded sessions.
 */

/** Ten participants covering the five personas named in the plan. */
export const UAT_PARTICIPANTS = [
  { id: "P01", persona: "approver" },
  { id: "P02", persona: "approver" },
  { id: "P03", persona: "operations" },
  { id: "P04", persona: "operations" },
  { id: "P05", persona: "tenant-admin" },
  { id: "P06", persona: "tenant-admin" },
  { id: "P07", persona: "employee" },
  { id: "P08", persona: "employee" },
  { id: "P09", persona: "designer" },
  { id: "P10", persona: "designer" },
];

/**
 * taskId, the scenario it represents, and the maintained spec that runs it.
 * `grep` is matched against the Playwright test title.
 */
export const UAT_TASKS = [
  {
    id: "UAT-01",
    scenario: "Sign in and reach the inbox",
    persona: "approver",
    file: "e2e/task-inbox.spec.ts",
    grep: "filters narrow the inbox to the matching rows",
  },
  {
    id: "UAT-02",
    scenario: "Decide a task (approve with a comment)",
    persona: "approver",
    file: "e2e/task-inbox.spec.ts",
    grep: "approving sends one request and shows the success toast",
  },
  {
    id: "UAT-03",
    scenario: "Complete a decision with the keyboard only",
    persona: "approver",
    file: "e2e/task-inbox.spec.ts",
    grep: "keyboard J/K move the cursor and A opens the approval confirmation",
  },
  {
    id: "UAT-04",
    scenario: "Start a published workflow from the catalogue",
    persona: "operations",
    file: "e2e/workflow-instance.spec.ts",
    grep: "starting a workflow sends the context and an idempotency key",
  },
  {
    id: "UAT-05",
    scenario: "Investigate an instance's timeline, logs and saga",
    persona: "operations",
    file: "e2e/workflow-instance.spec.ts",
    grep: "instance detail shows the node timeline, redacted logs and saga",
  },
  {
    id: "UAT-06",
    scenario: "Upload a document and follow the scan to promoted",
    persona: "operations",
    file: "e2e/phase-7-documents-notifications.spec.ts",
    grep: "T7-01 uploads a document",
  },
  {
    id: "UAT-07",
    scenario: "Manage identity: role change and audit trail",
    persona: "tenant-admin",
    file: "e2e/phase-8-analytics-admin.spec.ts",
    grep: "T8-03/T8-05 role confirmation",
  },
  {
    id: "UAT-08",
    scenario: "Read analytics and drill into a metric",
    persona: "tenant-admin",
    file: "e2e/phase-8-analytics-admin.spec.ts",
    grep: "T8-01/U8-07 server counts",
  },
  {
    id: "UAT-09",
    scenario: "Ask the Copilot and read its citations",
    persona: "approver",
    file: "e2e/phase-9-ai-copilot.spec.ts",
    grep: "T9-01/T9-02/T9-05",
  },
  {
    id: "UAT-10",
    scenario: "Use the product degraded: 200% zoom without horizontal scroll",
    persona: "all",
    file: "e2e/responsive.spec.ts",
    grep: "200% zoom equivalent does not scroll horizontally",
  },
];

/** Tasks whose timing is a release gate (plan item T8: critical path under 2 minutes). */
export const CRITICAL_PATH_TASKS = ["UAT-01", "UAT-02", "UAT-04", "UAT-09"];
export const CRITICAL_PATH_LIMIT_SECONDS = 120;

export function taskById(taskId) {
  return UAT_TASKS.find((task) => task.id === taskId);
}

# Manual screen-reader pass protocol (issue #366)

This document is the executable protocol for the NVDA and VoiceOver passes that
must accompany a release. It is intentionally separate from
[`../accessibility.md`](../accessibility.md): the automated axe/keyboard suite
proves structure and names, while this protocol proves what a real screen
reader announces, in what order, and whether the user can complete the task.

## Why a protocol instead of an axe run

An axe scan cannot hear output. It cannot detect duplicate live announcements,
a focus trap, a missing `aria-describedby` relationship that still passes
contrast, or a label that is technically present but meaningless. Those are the
failures this protocol targets.

## Environments

Both passes are mandatory before a production release. Record the exact
versions on the release ticket and in the evidence file.

| Pass | Required environment |
|---|---|
| NVDA | Windows 11 or 12, NVDA 2025.1 or later, Chrome and Firefox current stable |
| VoiceOver | macOS 15 or later, Safari current stable; one iOS pass for the inbox |

Tester prerequisites:

1. Read the 10-task UAT script ([`../uat-plan.md`](../uat-plan.md)) and the
   screen map ([`../../frontend/e2e/a11yFixtures.ts`](../../frontend/e2e/a11yFixtures.ts)).
2. Use synthetic tenant data only. Never read real personal data into the
   screen reader speech log.
3. Keep a stopwatch and a screen recorder. The evidence needs timestamps.
4. Disable notifications that could be mistaken for application announcements.

## Scripted journeys (T1–T10)

Every journey is executed twice: once with NVDA and once with VoiceOver. A
journey passes only when every measurable assertion is observed.

| ID | Journey | Measurable assertion |
|---|---|---|
| T1 | Sign in at `/` | Every field, button, error and the skip link is announced with a meaningful name; tab order is tenant → email → password → sign in. |
| T2 | Task inbox at `/tasks` | A row announces title, status, SLA and assignee. `J`/`K` move the cursor; `A`/`R` open the confirmation dialog and the dialog name states the action. |
| T3 | Task 360 at `/tasks?task=task-1` | The tab list is announced as tabs; each tab name and selected state is announced; every decision field has a label and hint. |
| T4 | Workflow designer at `/workflows/designer` | The palette, canvas and process navigator are reachable without a mouse; each navigator item announces the node name and type. |
| T5 | Form fill at `/forms/fill` | Submitting an empty required field moves focus to the error summary; the field announces its error through `aria-describedby`. |
| T6 | Documents at `/documents` | A scan-status change is announced exactly once through a polite live region; focus does not move. |
| T7 | Copilot HITL at `/copilot` | The confirmation panel is announced as a named region; the proposed action, title and payload hash are read before the approve/reject buttons. |
| T8 | Mobile drawer at `/dashboard` (390 px) | The drawer is announced, focus moves inside, Escape closes it and focus returns to the trigger. |
| T9 | Forced colours (Windows high contrast) | Every control and focus indicator remains visible; axe reports zero critical/serious violations with `forcedColors: active`. |
| T10 | 200% zoom / 640 px reflow | No horizontal document scroll; all actions remain reachable. |

## Unhappy paths (U1–U6)

| ID | Scenario | Expected announcement / behaviour |
|---|---|---|
| U1 | Session expires | The expiry message is announced and the user is redirected to sign in without losing the draft. |
| U2 | API returns 403 | A clear "forbidden" message is announced; the screen does not silently render empty. |
| U3 | Validation error | Focus moves to the error summary, which names the field. |
| U4 | Modal closes | Focus returns to the control that opened it. |
| U5 | Live update while reading | The update is polite and does not interrupt the current utterance. |
| U6 | Long Turkish text | Labels and errors remain readable; no truncation hides the action. |

## Evidence capture

Create one JSON file per run under
[`evidence/`](evidence/). The schema is enforced by
`frontend/scripts/a11y/check-protocol-evidence.mjs`:

```json
{
  "issue": 366,
  "executedAt": "YYYY-MM-DD",
  "executor": "name or team",
  "executionMode": "physical-at | automated-accessibility-tree-protocol",
  "assistiveTechnology": [
    { "name": "NVDA", "version": "2025.1", "browser": "Chrome 141", "platform": "Windows 11" },
    { "name": "VoiceOver", "version": "macOS 15", "browser": "Safari 18", "platform": "macOS" }
  ],
  "journeys": [
    { "id": "T1", "result": "PASS", "evidence": "frontend/e2e/accessibility-protocol.spec.ts#T1" }
  ],
  "unhappyPaths": [
    { "id": "U1", "result": "PASS", "evidence": "frontend/e2e/session-timeout.spec.ts" }
  ],
  "findings": [],
  "severityCounts": { "P0": 0, "P1": 0 },
  "limitations": "…",
  "riskAcceptance": {
    "required": false,
    "owner": "release-engineering",
    "reason": "…"
  }
}
```

`result` is `PASS`, `FAIL` or `NOT_EXECUTED`. A release is blocked when:

- any T/U row is missing or not `PASS`;
- `severityCounts.P0` or `severityCounts.P1` is greater than zero;
- a physical AT run has no browser/AT version;
- an automated run claims to be a physical run.

## Running the automated protocol in CI

The exact same journeys are exercised against the Chromium accessibility tree:

```bash
cd frontend
pnpm exec playwright test e2e/accessibility-protocol.spec.ts
pnpm a11y:protocol:check
```

The CI `End-to-End Tests` job runs the spec against the full Compose stack and
uploads the Playwright report. The `Frontend` job runs the evidence checker so a
missing or dishonest evidence file fails before the browser suite starts.

The automated run is **not** a substitute for NVDA or VoiceOver. It proves the
accessibility-tree contract the screen reader consumes; the physical run proves
the speech output. When the physical run cannot be performed in the build
environment, the evidence file must carry `riskAcceptance.required: true` with
an owner and reason, and the release ticket must link the signed run sheet.

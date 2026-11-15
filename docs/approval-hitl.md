# AI HITL handover to an APPROVAL task (issue #288)

When an AI node's confidence falls below the threshold, the engine no longer creates a generic
task. It creates a real APPROVAL task with the APPROVAL node semantics:

| Contract | Behaviour |
|---|---|
| Task type | `Task.taskType = APPROVAL` (migration V58; existing rows default to `GENERIC`). |
| Linkage | `tasks.node_execution_id` stores the AI node execution that produced the low-confidence decision. |
| Approvers | `config.approvers` is required for `APPROVAL`, `AI` and `AI_TASK` nodes; publishing without one fails with `400`. The first resolvable `role:` approver becomes the assignee. |
| SLA | `config.approvalSlaMinutes` (default 60, bounded to one week) becomes `tasks.escalate_at`. The existing escalation scheduler consumes it. |
| Idempotency | The task is reused when the same node execution is evaluated again; no duplicate task rows. |
| Decision | `approve` publishes `{"decision":"APPROVED"}`; `reject` publishes `{"decision":"REJECTED"}`. Graph conditions can route the rejection branch. Wrong approvers are rejected by the existing decision-rights check. |
| Duplicate decision | A second decision is rejected deterministically with `409` by the Task state machine. |

## Node configuration

```json
{
  "type": "AI_TASK",
  "id": "ai-decision",
  "config": {
    "action": "CLASSIFY",
    "prompt": "Classify the request",
    "approvers": ["role:TENANT_ADMIN"],
    "approvalSlaMinutes": 60
  }
}
```

## Migration

`V58__task_type_and_approval_linkage.sql` adds `tasks.task_type` with a `GENERIC` default and a
`(tenant_id, task_type, status)` index. No existing task changes meaning; only new APPROVAL tasks
carry the explicit type.

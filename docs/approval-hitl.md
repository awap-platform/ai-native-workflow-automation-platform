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
| Decision | `approve` publishes `TASK_COMPLETED` with a `NodeCompletedEvent`, which completes the linked node and advances the workflow. `reject` publishes `NODE_REJECTED`; the engine fails the node and instance deterministically and never resumes the node. Wrong approvers are rejected by the decision-rights check. |
| Duplicate decision | A second decision is rejected deterministically with `409` by the Task state machine and publishes no second completion. |

## Approval/resume contract (issue #304)

- `TASK_COMPLETED` is the only event that resumes a linked AI node. The consumer calls
  `WorkflowEngineService.onNodeCompleted`, which completes the `WAITING` node, moves a `WAITING`
  instance back to `RUNNING`, and evaluates outgoing transitions.
- Replaying the completion event is idempotent: an already-`COMPLETED` execution is not saved or
  advanced twice, which also makes an engine restart after approval safe.
- `NODE_REJECTED` is a separate topic (`workflow.task.rejected.events`) and handler. It fails the
  node and transitions the instance to `FAILED` (`AI_HITL_REJECTED`); it can never be parsed as a
  completion.
- Missing approver configuration fails at publish time; a wrong approver is rejected before any
  decision is persisted. Concurrent/duplicate decisions are serialized by the task state machine.

Tests: `WorkflowEngineServiceTest` (resume exactly once, rejection terminal path, idempotent
rejection) and `TaskServiceTest` (one completion on approve, rejection event, duplicate approval,
wrong approver).

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

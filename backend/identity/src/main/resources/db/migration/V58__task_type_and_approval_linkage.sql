-- V58: distinguish real APPROVAL-node tasks from generic tasks and expose the AI execution link
-- used by the HITL handover (issue #288).

ALTER TABLE tasks
    ADD COLUMN task_type VARCHAR(20) NOT NULL DEFAULT 'GENERIC';

CREATE INDEX idx_tasks_tenant_type_status
    ON tasks (tenant_id, task_type, status);

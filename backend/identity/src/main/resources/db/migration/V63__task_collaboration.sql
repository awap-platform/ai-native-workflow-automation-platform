-- Issue #371: task comments, attachment links and the unified activity source.

CREATE TABLE task_comments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    task_id UUID NOT NULL,
    author_id UUID NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted BOOLEAN NOT NULL
);

CREATE INDEX idx_task_comments_task ON task_comments(task_id, created_at);
CREATE INDEX idx_task_comments_tenant ON task_comments(tenant_id);

CREATE TABLE task_attachments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    task_id UUID NOT NULL,
    file_id UUID NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    scan_status VARCHAR(20) NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    deleted BOOLEAN NOT NULL
);

CREATE INDEX idx_task_attachments_task ON task_attachments(task_id, created_at);
CREATE INDEX idx_task_attachments_tenant ON task_attachments(tenant_id);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY task_comments_isolation ON task_comments
    USING (current_setting('awap.tenant_id', true) IS NULL
        OR tenant_id = current_setting('awap.tenant_id', true)::uuid);

ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY task_attachments_isolation ON task_attachments
    USING (current_setting('awap.tenant_id', true) IS NULL
        OR tenant_id = current_setting('awap.tenant_id', true)::uuid);

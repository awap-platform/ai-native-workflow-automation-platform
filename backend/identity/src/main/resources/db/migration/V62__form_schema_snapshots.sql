-- Issue #370: immutable schema snapshot per (form_id, version).
-- The snapshot is written when the definition version is created; it is never updated.

CREATE TABLE form_schema_snapshots (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    form_id UUID NOT NULL,
    version INTEGER NOT NULL,
    schema_json TEXT NOT NULL,
    schema_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_form_schema_snapshots UNIQUE (form_id, version)
);

CREATE INDEX idx_form_schema_snapshots_tenant ON form_schema_snapshots(tenant_id);
CREATE INDEX idx_form_schema_snapshots_form ON form_schema_snapshots(form_id);

ALTER TABLE form_schema_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_schema_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY form_schema_snapshots_isolation ON form_schema_snapshots
    USING (current_setting('awap.tenant_id', true) IS NULL
        OR tenant_id = current_setting('awap.tenant_id', true)::uuid);

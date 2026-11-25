-- Issue #372: resumable multipart uploads. One row per initiated upload; the staged parts live in
-- the quarantine bucket under staging_prefix so a reload can resume and the TTL job can clean up.

CREATE TABLE multipart_uploads (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    upload_id UUID NOT NULL,
    file_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    content_type VARCHAR(255),
    size BIGINT NOT NULL,
    expected_sha256 VARCHAR(64) NOT NULL,
    part_size BIGINT NOT NULL,
    part_count INTEGER NOT NULL,
    staging_prefix VARCHAR(512) NOT NULL,
    object_key VARCHAR(512) NOT NULL,
    status VARCHAR(20) NOT NULL,
    uploaded_parts TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_multipart_uploads_upload_id UNIQUE (upload_id)
);

CREATE INDEX idx_multipart_uploads_tenant ON multipart_uploads(tenant_id);
CREATE INDEX idx_multipart_uploads_expiry ON multipart_uploads(status, expires_at);

ALTER TABLE multipart_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE multipart_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY multipart_uploads_isolation ON multipart_uploads
    USING (current_setting('awap.tenant_id', true) IS NULL
        OR tenant_id = current_setting('awap.tenant_id', true)::uuid);

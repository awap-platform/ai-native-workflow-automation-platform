-- V61: Keyset pagination index for the Phase 8 admin audit console.
-- The existing (tenant_id, created_at DESC) index already serves the first page. The audit view
-- pages by an immutable (created_at, id) cursor so a deep page never scans to an offset; this
-- composite index keeps both the range predicate and the deterministic tie-break ordered.

CREATE INDEX IF NOT EXISTS idx_organization_audit_tenant_created_id
    ON organization_audit_events (tenant_id, created_at DESC, id DESC);

-- Issue #373: server-persisted Copilot sessions, turns and HITL approvals.
-- Content is tenant-scoped by RLS, turns form a hash chain for tamper evidence, and every session
-- expires so prompt content cannot live forever.

CREATE TABLE copilot_sessions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived BOOLEAN NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_copilot_sessions_tenant ON copilot_sessions(tenant_id, updated_at DESC);
CREATE INDEX idx_copilot_sessions_expiry ON copilot_sessions(expires_at);

CREATE TABLE copilot_turns (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    session_id UUID NOT NULL REFERENCES copilot_sessions(id),
    sequence INTEGER NOT NULL,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    previous_hash VARCHAR(64),
    tool_calls_json TEXT,
    citations_json TEXT,
    budget_json TEXT,
    approval_json TEXT,
    idempotency_key VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_copilot_turns_sequence UNIQUE (session_id, sequence),
    CONSTRAINT uq_copilot_turns_idempotency UNIQUE (session_id, idempotency_key)
);

CREATE INDEX idx_copilot_turns_session ON copilot_turns(session_id, sequence);
CREATE INDEX idx_copilot_turns_tenant ON copilot_turns(tenant_id);

CREATE TABLE copilot_hitl (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    session_id UUID NOT NULL REFERENCES copilot_sessions(id),
    turn_id UUID,
    state VARCHAR(20) NOT NULL,
    summary TEXT NOT NULL,
    proposal_json TEXT,
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_copilot_hitl_session ON copilot_hitl(session_id, state);
CREATE INDEX idx_copilot_hitl_tenant ON copilot_hitl(tenant_id);

ALTER TABLE copilot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY copilot_sessions_isolation ON copilot_sessions
    USING (current_setting('awap.tenant_id', true) IS NULL
        OR tenant_id = current_setting('awap.tenant_id', true)::uuid);

ALTER TABLE copilot_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_turns FORCE ROW LEVEL SECURITY;
CREATE POLICY copilot_turns_isolation ON copilot_turns
    USING (current_setting('awap.tenant_id', true) IS NULL
        OR tenant_id = current_setting('awap.tenant_id', true)::uuid);

ALTER TABLE copilot_hitl ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_hitl FORCE ROW LEVEL SECURITY;
CREATE POLICY copilot_hitl_isolation ON copilot_hitl
    USING (current_setting('awap.tenant_id', true) IS NULL
        OR tenant_id = current_setting('awap.tenant_id', true)::uuid);

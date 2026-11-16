-- V59: Durable, monthly, multi-replica-safe tenant AI token budget (issue #301).
--
-- The previous AiBudgetGuard kept a ConcurrentHashMap per JVM, so two replicas or a restart could
-- each admit the full budget. This schema owns the authoritative monthly ledger:
--
--   ai_budget_usage  one row per (tenant, UTC month) with used/reserved tokens
--   ai_budget_events idempotency ledger for reservations so a retried call cannot double-count
--
-- All mutations run through SECURITY INVOKER functions; the tenant transaction aspect sets
-- awap.tenant_id, so RLS remains in force for every read and write.

CREATE TABLE ai_budget_usage (
    tenant_id UUID NOT NULL,
    period DATE NOT NULL,
    used_tokens BIGINT NOT NULL DEFAULT 0,
    reserved_tokens BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_ai_budget_usage PRIMARY KEY (tenant_id, period),
    CONSTRAINT ck_ai_budget_usage_non_negative CHECK (used_tokens >= 0 AND reserved_tokens >= 0)
);

CREATE TABLE ai_budget_events (
    event_key VARCHAR(220) PRIMARY KEY,
    tenant_id UUID NOT NULL,
    period DATE NOT NULL,
    tokens BIGINT NOT NULL,
    kind VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_ai_budget_events_tokens_positive CHECK (tokens > 0),
    CONSTRAINT ck_ai_budget_events_kind CHECK (kind IN ('RESERVE', 'REFUND'))
);

CREATE INDEX idx_ai_budget_events_tenant_period ON ai_budget_events (tenant_id, period);

ALTER TABLE ai_budget_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_budget_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_budget_usage_isolation ON ai_budget_usage
    USING (tenant_id = current_setting('awap.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('awap.tenant_id', true)::uuid);

ALTER TABLE ai_budget_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_budget_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_budget_events_isolation ON ai_budget_events
    USING (tenant_id = current_setting('awap.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('awap.tenant_id', true)::uuid);

-- Atomic reservation. Returns the used token count after the reservation, or:
--   -1 : the tenant budget would be exceeded (nothing is counted)
--   -2 : the event key was already recorded (idempotent replay, nothing changed)
CREATE OR REPLACE FUNCTION awap_ai_budget_reserve(
    p_event_key TEXT,
    p_tenant UUID,
    p_period DATE,
    p_tokens BIGINT,
    p_limit BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inserted INT;
    v_used BIGINT;
BEGIN
    IF p_tokens IS NULL OR p_tokens <= 0 THEN
        RAISE EXCEPTION 'AI budget reservation must be positive';
    END IF;

    INSERT INTO ai_budget_events (event_key, tenant_id, period, tokens, kind, created_at)
    VALUES (p_event_key, p_tenant, p_period, p_tokens, 'RESERVE', now())
    ON CONFLICT (event_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
        RETURN -2;
    END IF;

    INSERT INTO ai_budget_usage (tenant_id, period, used_tokens, reserved_tokens, updated_at)
    VALUES (p_tenant, p_period, 0, 0, now())
    ON CONFLICT (tenant_id, period) DO NOTHING;

    -- A single conditional UPDATE serializes concurrent replicas on the row lock and re-evaluates
    -- the predicate after the wait, so exactly the remaining budget can be reserved.
    UPDATE ai_budget_usage
       SET used_tokens = used_tokens + p_tokens,
           reserved_tokens = reserved_tokens + p_tokens,
           updated_at = now()
     WHERE tenant_id = p_tenant
       AND period = p_period
       AND (p_limit < 0 OR used_tokens + p_tokens <= p_limit)
    RETURNING used_tokens INTO v_used;

    IF v_used IS NULL THEN
        DELETE FROM ai_budget_events WHERE event_key = p_event_key;
        RETURN -1;
    END IF;

    RETURN v_used;
END
$$;

-- Idempotent refund for a provider failure. Returns the used token count after the refund.
CREATE OR REPLACE FUNCTION awap_ai_budget_refund(
    p_event_key TEXT,
    p_tenant UUID,
    p_period DATE,
    p_tokens BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inserted INT;
    v_used BIGINT;
BEGIN
    IF p_tokens IS NULL OR p_tokens <= 0 THEN
        RETURN -1;
    END IF;

    INSERT INTO ai_budget_events (event_key, tenant_id, period, tokens, kind, created_at)
    VALUES (p_event_key, p_tenant, p_period, p_tokens, 'REFUND', now())
    ON CONFLICT (event_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
        SELECT used_tokens INTO v_used FROM ai_budget_usage
         WHERE tenant_id = p_tenant AND period = p_period;
        RETURN COALESCE(v_used, 0);
    END IF;

    UPDATE ai_budget_usage
       SET used_tokens = GREATEST(0, used_tokens - p_tokens),
           reserved_tokens = GREATEST(0, reserved_tokens - p_tokens),
           updated_at = now()
     WHERE tenant_id = p_tenant
       AND period = p_period
    RETURNING used_tokens INTO v_used;

    RETURN COALESCE(v_used, 0);
END
$$;

-- Reconciles the estimate with the provider's actual token usage. A negative or positive delta is
-- applied idempotently by the caller (actual usage is authoritative for the period).
CREATE OR REPLACE FUNCTION awap_ai_budget_reconcile(
    p_tenant UUID,
    p_period DATE,
    p_estimated BIGINT,
    p_actual BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_delta BIGINT;
    v_used BIGINT;
BEGIN
    v_delta = COALESCE(p_actual, 0) - COALESCE(p_estimated, 0);
    UPDATE ai_budget_usage
       SET used_tokens = GREATEST(0, used_tokens + v_delta),
           reserved_tokens = GREATEST(0, reserved_tokens + v_delta),
           updated_at = now()
     WHERE tenant_id = p_tenant
       AND period = p_period
    RETURNING used_tokens INTO v_used;
    RETURN COALESCE(v_used, 0);
END
$$;

REVOKE ALL ON FUNCTION awap_ai_budget_reserve(TEXT, UUID, DATE, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awap_ai_budget_reserve(TEXT, UUID, DATE, BIGINT, BIGINT) TO awap_app;
REVOKE ALL ON FUNCTION awap_ai_budget_refund(TEXT, UUID, DATE, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awap_ai_budget_refund(TEXT, UUID, DATE, BIGINT) TO awap_app;
REVOKE ALL ON FUNCTION awap_ai_budget_reconcile(UUID, DATE, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awap_ai_budget_reconcile(UUID, DATE, BIGINT, BIGINT) TO awap_app;

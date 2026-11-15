-- V57: Bounded raw-event samples used for advanced analytics aggregations (issue #285).
-- Daily totals remain authoritative in analytics_aggregates; these rows provide the exact
-- duration/cycle-time/approval-latency percentiles and node bottleneck rankings that cannot be
-- reconstructed from daily sums. OpenSearch remains the preferred large-scale raw-event store.

CREATE TABLE analytics_event_samples (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    workflow_instance_id UUID,
    task_id UUID,
    node_id VARCHAR(120),
    duration_ms BIGINT NOT NULL DEFAULT 0,
    occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_analytics_event_samples_tenant_occurred
    ON analytics_event_samples (tenant_id, occurred_at);

CREATE INDEX idx_analytics_event_samples_tenant_node
    ON analytics_event_samples (tenant_id, node_id);

ALTER TABLE analytics_event_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_event_samples FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_event_samples_isolation ON analytics_event_samples
    USING (tenant_id = current_setting('awap.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('awap.tenant_id', true)::uuid);

package com.awap.engine.application;

import java.util.UUID;

/**
 * A linked AI HITL approval task was rejected. Unlike a completion, a rejection must not resume the
 * node; the engine transitions the node and instance to a deterministic failed terminal state
 * (issue #304).
 */
public record NodeRejectedEvent(
    UUID tenantId, UUID workflowInstanceId, UUID nodeExecutionId, String reason) {}

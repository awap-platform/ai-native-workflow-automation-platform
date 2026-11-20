package com.awap.engine.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Public representation of a workflow instance.
 *
 * <p>{@code updatedAt} and {@code parentInstanceId} were added for the phase 4 instance monitor:
 * the list sorts by recency and the detail links a sub-process back to its parent.
 */
public record WorkflowInstanceResponse(
    UUID id,
    UUID tenantId,
    UUID workflowDefinitionId,
    int workflowVersion,
    String state,
    String contextJson,
    String idempotencyKey,
    Instant createdAt,
    Instant updatedAt,
    UUID parentInstanceId) {}

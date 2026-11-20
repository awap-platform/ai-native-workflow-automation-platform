package com.awap.workflow.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Public representation of a workflow definition.
 *
 * <p>The catalogue needs ownership and freshness (UI/UX phase 4), so the timestamps and creator are
 * additive fields on the existing contract.
 */
public record WorkflowDefinitionResponse(
    UUID id,
    UUID tenantId,
    String name,
    String description,
    String status,
    int currentVersion,
    Instant createdAt,
    Instant updatedAt,
    UUID createdBy) {}

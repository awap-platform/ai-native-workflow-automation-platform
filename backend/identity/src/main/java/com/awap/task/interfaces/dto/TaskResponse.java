package com.awap.task.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Public representation of a task.
 *
 * <p>The lifecycle timestamps and escalation deadline are additive fields (UI/UX phase 3). They let
 * the work item inbox render an accurate SLA countdown against server time instead of guessing a
 * deadline on the client.
 */
public record TaskResponse(
    UUID id,
    UUID tenantId,
    UUID workflowInstanceId,
    String title,
    String description,
    UUID assigneeId,
    String status,
    long version,
    String decisionComment,
    String taskType,
    boolean escalated,
    Instant escalateAt,
    Instant createdAt,
    Instant updatedAt,
    Instant completedAt) {}

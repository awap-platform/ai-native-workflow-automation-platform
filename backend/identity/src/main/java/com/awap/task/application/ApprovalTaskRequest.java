package com.awap.task.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Request for a real APPROVAL task (issue #288).
 *
 * <p>{@code nodeExecutionId} is the AI node execution that triggered the HITL handover, so the
 * approval is linked back to the exact AI decision. {@code escalateAt} carries the APPROVAL SLA.
 */
public record ApprovalTaskRequest(
    String title,
    String description,
    UUID workflowInstanceId,
    UUID nodeExecutionId,
    UUID assigneeId,
    List<String> approvers,
    Instant escalateAt) {}

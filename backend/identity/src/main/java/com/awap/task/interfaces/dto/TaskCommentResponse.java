package com.awap.task.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/** Public task comment representation. */
public record TaskCommentResponse(
    UUID id, UUID taskId, UUID authorId, String body, Instant createdAt) {}

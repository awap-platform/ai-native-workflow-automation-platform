package com.awap.task.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/** One entry in the unified chronological task activity stream. */
public record TaskActivityResponse(
    String id, String kind, UUID actorId, String summary, Instant createdAt) {}

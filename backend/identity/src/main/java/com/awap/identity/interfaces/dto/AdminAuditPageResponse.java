package com.awap.identity.interfaces.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** One keyset page of the immutable tenant audit trail. */
public record AdminAuditPageResponse(List<AuditEntry> items, String nextCursor, boolean hasMore) {

  /** One immutable audit event; values are strings so the console never coerces them. */
  public record AuditEntry(
      UUID id,
      String entityType,
      UUID entityId,
      String action,
      String oldValue,
      String newValue,
      UUID actorId,
      Instant createdAt) {}
}

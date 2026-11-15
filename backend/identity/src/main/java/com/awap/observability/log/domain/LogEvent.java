package com.awap.observability.log.domain;

import java.time.Instant;

/**
 * Structured operational log event (issue #286).
 *
 * <p>The schema is fixed and allowlisted. Free-form payloads are never indexed; only the message is
 * carried, and it is redacted before it reaches OpenSearch. {@code correlationId} and {@code
 * traceId} are required so backend and AI-layer entries can be correlated.
 */
public record LogEvent(
    String tenantId,
    String service,
    String level,
    String logger,
    String message,
    String correlationId,
    String traceId,
    Instant timestamp) {

  public LogEvent {
    if (tenantId == null || tenantId.isBlank()) {
      throw new IllegalArgumentException("tenantId is required");
    }
    if (message == null) {
      message = "";
    }
    service = blankToDefault(service, "awap-backend");
    level = blankToDefault(level, "INFO");
    logger = blankToDefault(logger, "unknown");
    correlationId = blankToDefault(correlationId, "");
    traceId = blankToDefault(traceId, "");
    timestamp = timestamp == null ? Instant.now() : timestamp;
  }

  private static String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }
}

package com.awap.analytics.application;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Paginated raw-event drill-down behind one analytics card or chart bucket.
 *
 * <p>{@code partial=true} means the raw-event source could not be read (for example OpenSearch or
 * the sample table is unavailable). The rows are then empty and the UI must show a partial state
 * instead of an empty-result claim.
 */
public record AnalyticsDrilldown(
    LocalDate from,
    LocalDate to,
    String eventType,
    int page,
    int size,
    long totalElements,
    int totalPages,
    boolean partial,
    String detail,
    List<Row> rows) {

  /** One sampled raw event. It carries identifiers and durations only, never a payload. */
  public record Row(
      UUID id,
      String eventType,
      UUID workflowInstanceId,
      UUID taskId,
      String nodeId,
      long durationMs,
      Instant occurredAt) {}
}

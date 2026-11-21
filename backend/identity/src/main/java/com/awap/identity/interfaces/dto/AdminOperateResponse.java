package com.awap.identity.interfaces.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Operator health projection for the Phase 8 operate dashboard.
 *
 * <p>All counters are server-side aggregates over tenant-scoped tables. The job list reports only
 * pipelines that expose durable state; there is intentionally no synthetic heartbeat.
 */
public record AdminOperateResponse(
    UUID tenantId,
    Instant generatedAt,
    WorkflowHealth workflows,
    InstanceHealth instances,
    TaskHealth tasks,
    OutboxHealth outbox,
    DlqHealth dlq,
    List<JobHealth> jobs) {

  /** Workflow definition counts. */
  public record WorkflowHealth(long total, long published, long draft) {}

  /** Workflow instance counts. */
  public record InstanceHealth(long total, long running, long failed, long completed) {}

  /** Task counts; `open` is every status that still needs work. */
  public record TaskHealth(long total, long open, long completed) {}

  /** Outbox backlog and exhausted rows. */
  public record OutboxHealth(long pending, long exhausted) {}

  /** Terminally failed notification deliveries shown by the DLQ view. */
  public record DlqHealth(long failed) {}

  /** One scheduled pipeline health row. */
  public record JobHealth(String name, String status, String detail) {}
}

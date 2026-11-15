package com.awap.analytics.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * One bounded raw analytics event sample (issue #285).
 *
 * <p>Daily sums are authoritative in {@link AnalyticsAggregate}; samples exist only to compute
 * exact percentiles, cycle times and bottleneck rankings for a bounded dashboard window. They carry
 * no raw payload and therefore no PII beyond identifiers already present in the event envelope.
 */
@Entity
@Table(
    name = "analytics_event_samples",
    indexes = {
      @Index(
          name = "idx_analytics_event_samples_tenant_occurred",
          columnList = "tenant_id,occurred_at"),
      @Index(name = "idx_analytics_event_samples_tenant_node", columnList = "tenant_id,node_id")
    })
public class AnalyticsEventSample {

  @Id
  @Column(nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private UUID tenantId;

  @Column(name = "event_type", nullable = false)
  private String eventType;

  @Column(name = "workflow_instance_id")
  private UUID workflowInstanceId;

  @Column(name = "task_id")
  private UUID taskId;

  @Column(name = "node_id")
  private String nodeId;

  @Column(name = "duration_ms", nullable = false)
  private long durationMs;

  @Column(name = "occurred_at", nullable = false)
  private Instant occurredAt;

  protected AnalyticsEventSample() {}

  private AnalyticsEventSample(
      UUID tenantId,
      String eventType,
      UUID workflowInstanceId,
      UUID taskId,
      String nodeId,
      long durationMs,
      Instant occurredAt) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.eventType = eventType;
    this.workflowInstanceId = workflowInstanceId;
    this.taskId = taskId;
    this.nodeId = nodeId;
    this.durationMs = Math.max(0, durationMs);
    this.occurredAt = occurredAt == null ? Instant.now() : occurredAt;
  }

  /** Factory keeps identifier validation in one place and prevents negative durations. */
  public static AnalyticsEventSample of(
      UUID tenantId,
      AnalyticsEventType eventType,
      UUID workflowInstanceId,
      UUID taskId,
      String nodeId,
      long durationMs,
      Instant occurredAt) {
    if (tenantId == null) {
      throw new IllegalArgumentException("tenantId is required");
    }
    if (eventType == null) {
      throw new IllegalArgumentException("eventType is required");
    }
    return new AnalyticsEventSample(
        tenantId, eventType.name(), workflowInstanceId, taskId, nodeId, durationMs, occurredAt);
  }

  public UUID getId() {
    return id;
  }

  public UUID getTenantId() {
    return tenantId;
  }

  public String getEventType() {
    return eventType;
  }

  public UUID getWorkflowInstanceId() {
    return workflowInstanceId;
  }

  public UUID getTaskId() {
    return taskId;
  }

  public String getNodeId() {
    return nodeId;
  }

  public long getDurationMs() {
    return durationMs;
  }

  public Instant getOccurredAt() {
    return occurredAt;
  }
}

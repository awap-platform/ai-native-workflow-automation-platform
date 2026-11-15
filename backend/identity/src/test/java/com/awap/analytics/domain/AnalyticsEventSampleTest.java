package com.awap.analytics.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AnalyticsEventSampleTest {

  @Test
  void factoryCopiesEveryFieldAndGeneratesAnId() {
    UUID tenant = UUID.randomUUID();
    UUID instance = UUID.randomUUID();
    UUID task = UUID.randomUUID();
    Instant occurred = Instant.parse("2026-11-15T10:00:00Z");

    AnalyticsEventSample sample =
        AnalyticsEventSample.of(
            tenant, AnalyticsEventType.TASK_COMPLETED, instance, task, "approval", 250L, occurred);

    assertThat(sample.getId()).isNotNull();
    assertThat(sample.getTenantId()).isEqualTo(tenant);
    assertThat(sample.getEventType()).isEqualTo("TASK_COMPLETED");
    assertThat(sample.getWorkflowInstanceId()).isEqualTo(instance);
    assertThat(sample.getTaskId()).isEqualTo(task);
    assertThat(sample.getNodeId()).isEqualTo("approval");
    assertThat(sample.getDurationMs()).isEqualTo(250L);
    assertThat(sample.getOccurredAt()).isEqualTo(occurred);
  }

  @Test
  void theJpaNoArgumentConstructorLeavesTheEntityUninitialised() {
    AnalyticsEventSample sample = new AnalyticsEventSample();

    assertThat(sample.getId()).isNull();
    assertThat(sample.getTenantId()).isNull();
    assertThat(sample.getEventType()).isNull();
  }

  @Test
  void negativeDurationIsClampedToZero() {
    AnalyticsEventSample sample =
        AnalyticsEventSample.of(
            UUID.randomUUID(), AnalyticsEventType.WORKFLOW_COMPLETED, null, null, null, -1L, null);

    assertThat(sample.getDurationMs()).isZero();
    assertThat(sample.getOccurredAt()).isNotNull();
  }

  @Test
  void identifiersAreMandatory() {
    assertThatThrownBy(
            () ->
                AnalyticsEventSample.of(
                    null, AnalyticsEventType.WORKFLOW_COMPLETED, null, null, null, 1L, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("tenantId");
    assertThatThrownBy(
            () -> AnalyticsEventSample.of(UUID.randomUUID(), null, null, null, null, 1L, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("eventType");
  }
}

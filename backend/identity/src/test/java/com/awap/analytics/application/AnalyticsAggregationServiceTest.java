package com.awap.analytics.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.analytics.domain.AnalyticsAggregate;
import com.awap.analytics.domain.AnalyticsEventSample;
import com.awap.analytics.domain.AnalyticsEventType;
import com.awap.analytics.infrastructure.AnalyticsAggregateRepository;
import com.awap.analytics.infrastructure.AnalyticsEventSampleRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AnalyticsAggregationServiceTest {

  private static final UUID TENANT = UUID.randomUUID();
  private static final UUID INSTANCE_A = UUID.randomUUID();
  private static final UUID INSTANCE_B = UUID.randomUUID();
  private static final UUID INSTANCE_C = UUID.randomUUID();
  private static final LocalDate DAY = LocalDate.of(2026, 11, 10);

  private final AnalyticsAggregateRepository aggregateRepository =
      mock(AnalyticsAggregateRepository.class);
  private final AnalyticsEventSampleRepository sampleRepository =
      mock(AnalyticsEventSampleRepository.class);
  private final AnalyticsAggregationService service =
      new AnalyticsAggregationService(aggregateRepository, sampleRepository);

  @Test
  void buildsTheFullDashboardFromAuthoritativeTotalsAndRawSamples() {
    AnalyticsDashboardQuery query =
        AnalyticsDashboardQuery.of(DAY, DAY.plusDays(1), "DAY", "EVENT_TYPE", 2);
    List<AnalyticsAggregate> aggregates = dailyAggregates();
    List<AnalyticsEventSample> samples = samples();
    when(aggregateRepository.findByTenantIdAndDayBetweenOrderByDayAscEventTypeAsc(
            eq(TENANT), eq(DAY), eq(DAY.plusDays(1))))
        .thenReturn(aggregates);
    when(sampleRepository
            .findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
                eq(TENANT), any(Instant.class), any(Instant.class)))
        .thenReturn(samples, previousSamples());

    AnalyticsDashboard dashboard = service.dashboard(TENANT, query);

    assertThat(dashboard.from()).isEqualTo(DAY);
    assertThat(dashboard.to()).isEqualTo(DAY.plusDays(1));
    assertThat(dashboard.granularity()).isEqualTo("DAY");
    assertThat(dashboard.timezone()).isEqualTo("UTC");
    assertThat(dashboard.dataCompleteness().dailyTotalsAvailable()).isTrue();
    assertThat(dashboard.dataCompleteness().rawEventsAvailable()).isTrue();
    assertThat(dashboard.dataCompleteness().sampleCount()).isEqualTo(13);
    assertThat(dashboard.dailyTotals()).hasSize(4);
    assertThat(dashboard.dailyTotals().getFirst().averageDurationMs()).isEqualTo(100);
    assertThat(dashboard.workflowDuration().p50()).isEqualTo(300);
    assertThat(dashboard.workflowDuration().p90()).isEqualTo(500);
    assertThat(dashboard.workflowDuration().p95()).isEqualTo(500);
    assertThat(dashboard.workflowDuration().p99()).isEqualTo(500);
    assertThat(dashboard.workflowDuration().sampleCount()).isEqualTo(5);
    assertThat(dashboard.taskCycleTime().p50()).isEqualTo(50);
    assertThat(dashboard.taskCycleTime().p95()).isEqualTo(150);
    assertThat(dashboard.approvalLatency().p50()).isEqualTo(20);
    assertThat(dashboard.approvalLatency().p95()).isEqualTo(40);
    assertThat(dashboard.failureRate()).isEqualTo(0.1429);
    assertThat(dashboard.slaBreachRate()).isEqualTo(0.125);
    assertThat(dashboard.bottlenecks())
        .extracting(AnalyticsDashboard.Bottleneck::nodeId)
        .containsExactly("form", "approval");
    assertThat(dashboard.bottlenecks().getFirst().averageDurationMs()).isEqualTo(100);
    assertThat(dashboard.bottlenecks().getFirst().p95DurationMs()).isEqualTo(150);
    assertThat(dashboard.groups())
        .extracting(AnalyticsDashboard.GroupSummary::key)
        .containsExactly("WORKFLOW_COMPLETED", "APPROVAL_COMPLETED");
    assertThat(dashboard.trend().currentCount()).isEqualTo(13);
    assertThat(dashboard.trend().previousCount()).isEqualTo(3);
    assertThat(dashboard.trend().delta()).isEqualTo(10);
    assertThat(dashboard.timeBuckets()).hasSize(2);
    assertThat(dashboard.timeBuckets().getFirst().total()).isEqualTo(5);
    assertThat(dashboard.timeBuckets().getFirst().counts())
        .containsEntry("WORKFLOW_COMPLETED", 4L)
        .containsEntry("WORKFLOW_FAILED", 1L);
  }

  @Test
  void marksTheResponsePartialWhenRawEventsAreUnavailable() {
    AnalyticsAggregationService aggregateOnly =
        new AnalyticsAggregationService(aggregateRepository, null);
    AnalyticsDashboardQuery query = AnalyticsDashboardQuery.of(DAY, DAY, null, null, null);
    when(aggregateRepository.findByTenantIdAndDayBetweenOrderByDayAscEventTypeAsc(
            eq(TENANT), eq(DAY), eq(DAY)))
        .thenReturn(dailyAggregates());

    AnalyticsDashboard dashboard = aggregateOnly.dashboard(TENANT, query);

    assertThat(dashboard.dataCompleteness().dailyTotalsAvailable()).isTrue();
    assertThat(dashboard.dataCompleteness().rawEventsAvailable()).isFalse();
    assertThat(dashboard.dataCompleteness().sampleCount()).isZero();
    assertThat(dashboard.workflowDuration().p50()).isNull();
    assertThat(dashboard.taskCycleTime().sampleCount()).isZero();
    assertThat(dashboard.bottlenecks()).isEmpty();
    assertThat(dashboard.groups()).isEmpty();
    assertThat(dashboard.trend().currentCount()).isZero();
    assertThat(dashboard.trend().previousCount()).isZero();
    assertThat(dashboard.trend().delta()).isZero();
  }

  @Test
  void returnsAnExplicitEmptyResultWhenBothSourcesAreUnavailable() {
    AnalyticsAggregationService empty = new AnalyticsAggregationService(null, null);

    AnalyticsDashboard dashboard =
        empty.dashboard(TENANT, AnalyticsDashboardQuery.of(DAY, DAY, null, null, null));

    assertThat(dashboard.dataCompleteness().dailyTotalsAvailable()).isFalse();
    assertThat(dashboard.dataCompleteness().rawEventsAvailable()).isFalse();
    assertThat(dashboard.dailyTotals()).isEmpty();
    assertThat(dashboard.timeBuckets()).isEmpty();
    assertThat(dashboard.workflowDuration().p50()).isNull();
    assertThat(dashboard.failureRate()).isZero();
    assertThat(dashboard.slaBreachRate()).isZero();
  }

  @Test
  void bucketsDailyTotalsByIsoWeekAndMonth() {
    when(aggregateRepository.findByTenantIdAndDayBetweenOrderByDayAscEventTypeAsc(
            eq(TENANT), any(), any()))
        .thenReturn(dailyAggregates());
    when(sampleRepository
            .findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
                eq(TENANT), any(Instant.class), any(Instant.class)))
        .thenReturn(List.of(), List.of());

    AnalyticsDashboard week =
        service.dashboard(
            TENANT, AnalyticsDashboardQuery.of(DAY, DAY.plusDays(1), "WEEK", null, 5));
    AnalyticsDashboard month =
        service.dashboard(
            TENANT, AnalyticsDashboardQuery.of(DAY, DAY.plusDays(1), "MONTH", null, 5));

    assertThat(week.timeBuckets()).hasSize(1);
    assertThat(week.timeBuckets().getFirst().bucket()).isEqualTo("2026-11-09");
    assertThat(month.timeBuckets()).hasSize(1);
    assertThat(month.timeBuckets().getFirst().bucket()).isEqualTo("2026-11-01");
  }

  @Test
  void groupsByNodeAndWorkflowAndSkipsMissingKeys() {
    List<AnalyticsEventSample> samples =
        List.of(
            sample(AnalyticsEventType.TASK_COMPLETED, INSTANCE_A, "approval", 100),
            sample(AnalyticsEventType.TASK_COMPLETED, INSTANCE_A, " ", 200),
            sample(AnalyticsEventType.TASK_COMPLETED, null, "form", 300));
    when(aggregateRepository.findByTenantIdAndDayBetweenOrderByDayAscEventTypeAsc(
            eq(TENANT), any(), any()))
        .thenReturn(List.of());
    when(sampleRepository
            .findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
                eq(TENANT), any(Instant.class), any(Instant.class)))
        .thenReturn(samples, List.of(), samples, List.of());

    AnalyticsDashboard byNode =
        service.dashboard(TENANT, AnalyticsDashboardQuery.of(DAY, DAY, null, "NODE", 1));
    AnalyticsDashboard byWorkflow =
        service.dashboard(TENANT, AnalyticsDashboardQuery.of(DAY, DAY, null, "WORKFLOW", 10));

    assertThat(byNode.groups())
        .extracting(AnalyticsDashboard.GroupSummary::key)
        .containsExactly("approval");
    assertThat(byNode.groups().getFirst().count()).isEqualTo(1);
    assertThat(byWorkflow.groups())
        .extracting(AnalyticsDashboard.GroupSummary::key)
        .containsExactly(INSTANCE_A.toString());
  }

  @Test
  void percentileHandlesEmptySingleAndBoundaryInputs() {
    assertThat(AnalyticsAggregationService.percentile(List.of(), 50.0)).isNull();
    assertThat(AnalyticsAggregationService.percentile(List.of(7L), 99.0)).isEqualTo(7L);
    assertThat(AnalyticsAggregationService.percentile(List.of(1L, 2L, 3L), 0.0)).isEqualTo(1L);
    assertThat(AnalyticsAggregationService.percentile(List.of(1L, 2L, 3L), 100.0)).isEqualTo(3L);
    assertThat(AnalyticsAggregationService.percentile(List.of(1L, 2L, 3L, 4L), 50.0)).isEqualTo(2L);
  }

  @Test
  void ratesAreZeroWithoutADenominator() {
    when(aggregateRepository.findByTenantIdAndDayBetweenOrderByDayAscEventTypeAsc(
            eq(TENANT), any(), any()))
        .thenReturn(List.of());
    when(sampleRepository
            .findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
                eq(TENANT), any(Instant.class), any(Instant.class)))
        .thenReturn(List.of(), List.of());

    AnalyticsDashboard dashboard =
        service.dashboard(TENANT, AnalyticsDashboardQuery.of(DAY, DAY, null, null, null));

    assertThat(dashboard.failureRate()).isZero();
    assertThat(dashboard.slaBreachRate()).isZero();
  }

  private List<AnalyticsAggregate> dailyAggregates() {
    return List.of(
        aggregate(DAY, AnalyticsEventType.WORKFLOW_COMPLETED, 4, 400),
        aggregate(DAY, AnalyticsEventType.WORKFLOW_FAILED, 1, 50),
        aggregate(DAY.plusDays(1), AnalyticsEventType.WORKFLOW_COMPLETED, 2, 200),
        aggregate(DAY.plusDays(1), AnalyticsEventType.SLA_BREACHED, 1, 10));
  }

  private static AnalyticsAggregate aggregate(
      LocalDate day, AnalyticsEventType type, int count, long total) {
    AnalyticsAggregate aggregate = new AnalyticsAggregate(TENANT, day, type.name());
    for (int index = 0; index < count; index++) {
      aggregate.add(total / count);
    }
    return aggregate;
  }

  private List<AnalyticsEventSample> samples() {
    return List.of(
        sample(AnalyticsEventType.WORKFLOW_COMPLETED, INSTANCE_A, null, 100),
        sample(AnalyticsEventType.WORKFLOW_COMPLETED, INSTANCE_A, null, 200),
        sample(AnalyticsEventType.WORKFLOW_COMPLETED, INSTANCE_B, null, 300),
        sample(AnalyticsEventType.WORKFLOW_COMPLETED, INSTANCE_B, null, 400),
        sample(AnalyticsEventType.WORKFLOW_COMPLETED, INSTANCE_A, null, 500),
        sample(AnalyticsEventType.WORKFLOW_FAILED, INSTANCE_C, null, 60),
        sample(AnalyticsEventType.TASK_COMPLETED, INSTANCE_A, "form", 50),
        sample(AnalyticsEventType.TASK_COMPLETED, INSTANCE_B, "form", 150),
        sample(AnalyticsEventType.APPROVAL_COMPLETED, INSTANCE_A, "approval", 10),
        sample(AnalyticsEventType.APPROVAL_COMPLETED, INSTANCE_A, "approval", 20),
        sample(AnalyticsEventType.APPROVAL_COMPLETED, INSTANCE_B, "approval", 30),
        sample(AnalyticsEventType.APPROVAL_COMPLETED, INSTANCE_B, "approval", 40),
        sample(AnalyticsEventType.SLA_BREACHED, INSTANCE_C, null, 5));
  }

  private static List<AnalyticsEventSample> previousSamples() {
    return List.of(
        sample(AnalyticsEventType.WORKFLOW_COMPLETED, INSTANCE_A, null, 10),
        sample(AnalyticsEventType.WORKFLOW_COMPLETED, INSTANCE_A, null, 20),
        sample(AnalyticsEventType.WORKFLOW_COMPLETED, INSTANCE_A, null, 30));
  }

  private static AnalyticsEventSample sample(
      AnalyticsEventType type, UUID instance, String nodeId, long durationMs) {
    return AnalyticsEventSample.of(
        TENANT, type, instance, null, nodeId, durationMs, Instant.parse("2026-11-10T10:00:00Z"));
  }
}

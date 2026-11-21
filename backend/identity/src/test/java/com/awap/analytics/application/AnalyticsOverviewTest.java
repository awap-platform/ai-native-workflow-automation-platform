package com.awap.analytics.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AnalyticsOverviewTest {

  static AnalyticsDashboard dashboard(AnalyticsDashboard.DailyTotal... totals) {
    return new AnalyticsDashboard(
        LocalDate.of(2026, 11, 2),
        LocalDate.of(2026, 11, 8),
        "DAY",
        "UTC",
        new AnalyticsDashboard.DataCompleteness(true, true, 3),
        List.of(totals),
        List.of(),
        AnalyticsDashboard.PercentileSet.empty(),
        AnalyticsDashboard.PercentileSet.empty(),
        AnalyticsDashboard.PercentileSet.empty(),
        0.1,
        0.05,
        List.of(),
        List.of(),
        new AnalyticsDashboard.Trend(3, 1, 2));
  }

  @Test
  void foldsDailyTotalsIntoStablePerEventTypeRows() {
    AnalyticsDashboard dashboard =
        dashboard(
            new AnalyticsDashboard.DailyTotal(
                LocalDate.of(2026, 11, 2), "WORKFLOW_COMPLETED", 2, 4000, 2000),
            new AnalyticsDashboard.DailyTotal(
                LocalDate.of(2026, 11, 3), "WORKFLOW_COMPLETED", 3, 9000, 3000),
            new AnalyticsDashboard.DailyTotal(
                LocalDate.of(2026, 11, 3), "TASK_COMPLETED", 1, 500, 500));

    AnalyticsOverview overview = AnalyticsOverview.of(dashboard);

    assertThat(overview.totalEvents()).isEqualTo(6);
    assertThat(overview.eventTotals())
        .extracting(AnalyticsOverview.EventTotal::eventType)
        .containsExactly("TASK_COMPLETED", "WORKFLOW_COMPLETED");
    assertThat(overview.eventTotals().get(1).count()).isEqualTo(5);
    assertThat(overview.eventTotals().get(1).totalDurationMs()).isEqualTo(13000);
    assertThat(overview.eventTotals().get(1).averageDurationMs()).isEqualTo(2600);
  }

  @Test
  void anEmptyWindowProducesNoEventTotalsAndNeverADivideByZero() {
    AnalyticsOverview overview =
        AnalyticsOverview.of(
            dashboard(
                new AnalyticsDashboard.DailyTotal(
                    LocalDate.of(2026, 11, 2), "WORKFLOW_FAILED", 0, 0, 0)));

    assertThat(overview.totalEvents()).isZero();
    assertThat(overview.eventTotals()).hasSize(1);
    assertThat(overview.eventTotals().get(0).averageDurationMs()).isZero();
  }

  @Test
  void theServiceDelegatesToTheAuthoritativeAggregation() {
    AnalyticsAggregationService aggregationService = mock(AnalyticsAggregationService.class);
    AnalyticsOverviewService service = new AnalyticsOverviewService(aggregationService);
    AnalyticsDashboardQuery query =
        AnalyticsDashboardQuery.of(
            LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 8), "DAY", "EVENT_TYPE", 10);
    AnalyticsDashboard dashboard =
        dashboard(
            new AnalyticsDashboard.DailyTotal(
                LocalDate.of(2026, 11, 2), "WORKFLOW_COMPLETED", 1, 1000, 1000));
    when(aggregationService.dashboard(
            UUID.fromString("00000000-0000-0000-0000-000000000001"), query))
        .thenReturn(dashboard);

    AnalyticsOverview overview =
        service.overview(UUID.fromString("00000000-0000-0000-0000-000000000001"), query);

    assertThat(overview.dashboard()).isSameAs(dashboard);
    verify(aggregationService)
        .dashboard(UUID.fromString("00000000-0000-0000-0000-000000000001"), query);
  }
}

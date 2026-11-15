package com.awap.analytics.interfaces.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.analytics.application.AnalyticsAggregationService;
import com.awap.analytics.application.AnalyticsDashboard;
import com.awap.analytics.application.AnalyticsDashboardQuery;
import com.awap.analytics.application.AnalyticsService;
import com.awap.analytics.domain.AnalyticsAggregate;
import com.awap.common.api.AwapException;
import com.awap.identity.infrastructure.security.TenantContext;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AnalyticsControllerTest {

  private static final UUID TENANT = UUID.randomUUID();
  private static final UUID USER = UUID.randomUUID();
  private static final LocalDate DAY = LocalDate.of(2026, 11, 10);

  private final AnalyticsService analyticsService = mock(AnalyticsService.class);
  private final AnalyticsAggregationService aggregationService =
      mock(AnalyticsAggregationService.class);
  private final AnalyticsController controller =
      new AnalyticsController(analyticsService, aggregationService);

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT, USER, "MEMBER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void summaryMapsAggregatesAndHandlesZeroCounts() {
    AnalyticsAggregate empty = new AnalyticsAggregate(TENANT, DAY, "WORKFLOW_FAILED");
    AnalyticsAggregate populated = new AnalyticsAggregate(TENANT, DAY, "WORKFLOW_COMPLETED");
    populated.add(100L);
    populated.add(200L);
    when(analyticsService.summary(TENANT, DAY, DAY.plusDays(1)))
        .thenReturn(List.of(empty, populated));

    List<AnalyticsController.AnalyticsAggregateResponse> response =
        controller.summary(DAY, DAY.plusDays(1)).getBody();

    assertThat(response).hasSize(2);
    assertThat(response.getFirst().averageDurationMs()).isZero();
    assertThat(response.get(1).averageDurationMs()).isEqualTo(150);
  }

  @Test
  void summaryRejectsAnInvertedRange() {
    assertThatThrownBy(() -> controller.summary(DAY, DAY.minusDays(1)))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(400));
  }

  @Test
  void summaryRequiresATenantContext() {
    TenantContext.clear();

    assertThatThrownBy(() -> controller.summary(DAY, DAY))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(401));
  }

  @Test
  void dashboardValidatesTheQueryAndDelegatesToTheAggregationService() {
    AnalyticsDashboard dashboard = dashboard();
    when(aggregationService.dashboard(eq(TENANT), any(AnalyticsDashboardQuery.class)))
        .thenReturn(dashboard);

    AnalyticsDashboard response = controller.dashboard(DAY, DAY, "day", "node", 5).getBody();

    assertThat(response).isSameAs(dashboard);
    verify(aggregationService)
        .dashboard(
            eq(TENANT),
            org.mockito.ArgumentMatchers.argThat(
                query ->
                    query.from().equals(DAY)
                        && query.to().equals(DAY)
                        && query.granularity() == AnalyticsDashboardQuery.Granularity.DAY
                        && query.groupBy() == AnalyticsDashboardQuery.GroupBy.NODE
                        && query.limit() == 5));
  }

  @Test
  void dashboardRequiresATenantContext() {
    TenantContext.clear();

    assertThatThrownBy(() -> controller.dashboard(DAY, DAY, null, null, null))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(401));
  }

  @Test
  void dashboardRejectsAnInvalidQueryBeforeResolvingTheTenant() {
    TenantContext.clear();

    assertThatThrownBy(() -> controller.dashboard(DAY, DAY.minusDays(1), null, null, null))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(400));
  }

  private static AnalyticsDashboard dashboard() {
    AnalyticsDashboard.PercentileSet empty = AnalyticsDashboard.PercentileSet.empty();
    return new AnalyticsDashboard(
        DAY,
        DAY,
        "DAY",
        "UTC",
        new AnalyticsDashboard.DataCompleteness(true, true, 0),
        List.of(),
        List.of(new AnalyticsDashboard.TimeBucket("2026-11-10", 0, Map.of())),
        empty,
        empty,
        empty,
        0.0,
        0.0,
        List.of(),
        List.of(),
        new AnalyticsDashboard.Trend(0, 0, 0));
  }
}

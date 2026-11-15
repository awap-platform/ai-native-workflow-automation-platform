package com.awap.analytics.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.awap.common.api.AwapException;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class AnalyticsDashboardQueryTest {

  private static final LocalDate END = LocalDate.of(2026, 11, 15);

  @Test
  void defaultsToTheLastSevenUtcDaysDayBucketsEventTypeAndTenGroups() {
    AnalyticsDashboardQuery query = AnalyticsDashboardQuery.of(null, END, null, null, null);

    assertThat(query.from()).isEqualTo(END.minusDays(6));
    assertThat(query.to()).isEqualTo(END);
    assertThat(query.granularity()).isEqualTo(AnalyticsDashboardQuery.Granularity.DAY);
    assertThat(query.groupBy()).isEqualTo(AnalyticsDashboardQuery.GroupBy.EVENT_TYPE);
    assertThat(query.limit()).isEqualTo(AnalyticsDashboardQuery.DEFAULT_LIMIT);
  }

  @Test
  void defaultsToTodayWhenBothBoundsAreNull() {
    AnalyticsDashboardQuery query = AnalyticsDashboardQuery.of(null, null, "", "", 1);

    assertThat(query.to()).isEqualTo(LocalDate.now(java.time.ZoneOffset.UTC));
    assertThat(query.limit()).isEqualTo(1);
  }

  @Test
  void parsesGranularityAndGroupByCaseAndWhitespaceInsensitively() {
    AnalyticsDashboardQuery query =
        AnalyticsDashboardQuery.of(END.minusDays(10), END, " week ", " node ", 5);

    assertThat(query.granularity()).isEqualTo(AnalyticsDashboardQuery.Granularity.WEEK);
    assertThat(query.groupBy()).isEqualTo(AnalyticsDashboardQuery.GroupBy.NODE);
  }

  @Test
  void acceptsTheMaximumWindowBoundary() {
    LocalDate start = END.minusDays(AnalyticsDashboardQuery.MAX_WINDOW_DAYS - 1L);

    AnalyticsDashboardQuery query = AnalyticsDashboardQuery.of(start, END, "MONTH", "WORKFLOW", 50);

    assertThat(query.from()).isEqualTo(start);
    assertThat(query.granularity()).isEqualTo(AnalyticsDashboardQuery.Granularity.MONTH);
    assertThat(query.groupBy()).isEqualTo(AnalyticsDashboardQuery.GroupBy.WORKFLOW);
  }

  @Test
  void rejectsAnInvertedRange() {
    assertThatThrownBy(() -> AnalyticsDashboardQuery.of(END, END.minusDays(1), null, null, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("from must not be after to")
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(400));
  }

  @Test
  void rejectsARangeLongerThanTheMaximumWindow() {
    assertThatThrownBy(
            () ->
                AnalyticsDashboardQuery.of(
                    END.minusDays(AnalyticsDashboardQuery.MAX_WINDOW_DAYS), END, null, null, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("must not exceed");
  }

  @Test
  void rejectsAnUnknownGranularity() {
    assertThatThrownBy(() -> AnalyticsDashboardQuery.of(END.minusDays(1), END, "HOUR", null, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("granularity");
  }

  @Test
  void rejectsAnUnknownGroupBy() {
    assertThatThrownBy(
            () -> AnalyticsDashboardQuery.of(END.minusDays(1), END, null, "TENANT", null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("groupBy");
  }

  @Test
  void rejectsALimitOutsideTheAllowedRange() {
    assertThatThrownBy(() -> AnalyticsDashboardQuery.of(END.minusDays(1), END, null, null, 0))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("limit");
    assertThatThrownBy(() -> AnalyticsDashboardQuery.of(END.minusDays(1), END, null, null, 51))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("limit");
  }

  @Test
  void theRecordConstructorRejectsMissingBounds() {
    assertThatThrownBy(
            () ->
                new AnalyticsDashboardQuery(
                    null,
                    END,
                    AnalyticsDashboardQuery.Granularity.DAY,
                    AnalyticsDashboardQuery.GroupBy.EVENT_TYPE,
                    10))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new AnalyticsDashboardQuery(
                    END,
                    null,
                    AnalyticsDashboardQuery.Granularity.DAY,
                    AnalyticsDashboardQuery.GroupBy.EVENT_TYPE,
                    10))
        .isInstanceOf(IllegalArgumentException.class);
  }
}

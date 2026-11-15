package com.awap.observability.log.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.awap.common.api.AwapException;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class LogSearchQueryTest {

  private final Instant end = Instant.parse("2026-11-15T10:00:00Z");

  @Test
  void defaultsToOneDayAndFiftyRows() {
    LogSearchQuery query = LogSearchQuery.of(null, null, end, null);

    assertThat(query.from()).isEqualTo(end.minus(Duration.ofDays(1)));
    assertThat(query.to()).isEqualTo(end);
    assertThat(query.limit()).isEqualTo(LogSearchQuery.DEFAULT_LIMIT);
    assertThat(query.correlationId()).isEmpty();
  }

  @Test
  void normalizesTheCorrelationId() {
    LogSearchQuery query = LogSearchQuery.of("  ABC-123  ", end.minusSeconds(60), end, 10);

    assertThat(query.correlationId()).isEqualTo("abc-123");
    assertThat(query.limit()).isEqualTo(10);
  }

  @Test
  void rejectsAnInvertedWindow() {
    assertThatThrownBy(() -> LogSearchQuery.of(null, end, end.minusSeconds(1), null))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(400));
  }

  @Test
  void rejectsAWindowLongerThanThirtyDays() {
    assertThatThrownBy(() -> LogSearchQuery.of(null, end.minus(Duration.ofDays(31)), end, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("30 days");
  }

  @Test
  void rejectsALimitOutsideTheAllowedRange() {
    assertThatThrownBy(() -> LogSearchQuery.of(null, end.minusSeconds(1), end, 0))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("limit");
    assertThatThrownBy(() -> LogSearchQuery.of(null, end.minusSeconds(1), end, 201))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("limit");
  }
}

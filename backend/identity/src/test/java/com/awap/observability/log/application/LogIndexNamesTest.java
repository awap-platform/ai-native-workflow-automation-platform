package com.awap.observability.log.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class LogIndexNamesTest {

  private final Instant timestamp = Instant.parse("2026-11-15T10:00:00Z");

  @Test
  void resolvesTheDailyIndexAndDeadLetterIndex() {
    LogIndexNames names = new LogIndexNames("awap-logs");

    assertThat(names.dailyIndex(timestamp)).isEqualTo("awap-logs-2026.11.15");
    assertThat(names.deadLetterIndex(timestamp)).isEqualTo("awap-logs-dlq-2026.11.15");
    assertThat(names.pattern()).isEqualTo("awap-logs-*");
    assertThat(names.deadLetterPattern()).isEqualTo("awap-logs-dlq-*");
    assertThat(names.prefix()).isEqualTo("awap-logs");
  }

  @Test
  void fallsBackToTheDefaultPrefix() {
    assertThat(new LogIndexNames(null).prefix()).isEqualTo(LogIndexNames.DEFAULT_PREFIX);
    assertThat(new LogIndexNames(" ").prefix()).isEqualTo(LogIndexNames.DEFAULT_PREFIX);
  }
}

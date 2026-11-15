package com.awap.observability.log.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class LogEventTest {

  @Test
  void appliesSafeDefaultsForOptionalFields() {
    LogEvent event = new LogEvent("tenant-1", null, null, null, null, null, null, null);

    assertThat(event.tenantId()).isEqualTo("tenant-1");
    assertThat(event.service()).isEqualTo("awap-backend");
    assertThat(event.level()).isEqualTo("INFO");
    assertThat(event.logger()).isEqualTo("unknown");
    assertThat(event.message()).isEmpty();
    assertThat(event.correlationId()).isEmpty();
    assertThat(event.traceId()).isEmpty();
    assertThat(event.timestamp()).isNotNull();
  }

  @Test
  void keepsEveryProvidedField() {
    Instant timestamp = Instant.parse("2026-11-15T10:00:00Z");
    LogEvent event =
        new LogEvent(
            "tenant-1", "ai-layer", "WARN", "awap.test", "hello", "corr-1", "trace-1", timestamp);

    assertThat(event.service()).isEqualTo("ai-layer");
    assertThat(event.level()).isEqualTo("WARN");
    assertThat(event.logger()).isEqualTo("awap.test");
    assertThat(event.message()).isEqualTo("hello");
    assertThat(event.correlationId()).isEqualTo("corr-1");
    assertThat(event.traceId()).isEqualTo("trace-1");
    assertThat(event.timestamp()).isEqualTo(timestamp);
  }

  @Test
  void tenantIsMandatory() {
    assertThatThrownBy(() -> new LogEvent(null, null, null, null, null, null, null, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("tenantId");
    assertThatThrownBy(() -> new LogEvent(" ", null, null, null, null, null, null, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("tenantId");
  }
}

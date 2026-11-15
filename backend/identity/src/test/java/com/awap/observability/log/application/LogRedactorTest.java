package com.awap.observability.log.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.awap.observability.log.domain.LogEvent;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LogRedactorTest {

  private final LogRedactor redactor = new LogRedactor();

  @Test
  void producesOnlyTheAllowlistedDocumentFields() {
    LogEvent event =
        new LogEvent(
            "tenant-1",
            "ai-layer",
            "INFO",
            "awap.test",
            "contact ada@example.com",
            "corr-1",
            "trace-1",
            Instant.parse("2026-11-15T10:00:00Z"));

    Map<String, Object> document = redactor.document(event);

    assertThat(document)
        .containsEntry("tenantId", "tenant-1")
        .containsEntry("service", "ai-layer")
        .containsEntry("level", "INFO")
        .containsEntry("logger", "awap.test")
        .containsEntry("correlationId", "corr-1")
        .containsEntry("traceId", "trace-1")
        .containsEntry("message", "contact [REDACTED]")
        .containsEntry("timestamp", "2026-11-15T10:00:00Z");
    assertThat(document).hasSize(8);
  }

  @Test
  void exposesPiiDetectionAndTextRedaction() {
    assertThat(redactor.containsPii("call 555-123-4567")).isTrue();
    assertThat(redactor.containsPii("nothing sensitive")).isFalse();
    assertThat(redactor.containsPii(null)).isFalse();
    assertThat(redactor.redact("mail ada@example.com")).isEqualTo("mail [REDACTED]");
  }
}

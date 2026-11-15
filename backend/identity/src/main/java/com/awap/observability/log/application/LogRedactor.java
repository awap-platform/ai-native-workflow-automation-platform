package com.awap.observability.log.application;

import com.awap.analytics.application.AnalyticsPiiRedactor;
import com.awap.observability.log.domain.LogEvent;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Converts a {@link LogEvent} into the exact OpenSearch document shape and masks e-mail addresses,
 * phone numbers and SSNs in the message (issue #286). Unknown fields are never copied.
 */
public final class LogRedactor {

  private final AnalyticsPiiRedactor delegate = new AnalyticsPiiRedactor();

  public Map<String, Object> document(LogEvent event) {
    Map<String, Object> document = new LinkedHashMap<>();
    document.put("tenantId", event.tenantId());
    document.put("service", event.service());
    document.put("level", event.level());
    document.put("logger", event.logger());
    document.put("message", redact(event.message()));
    document.put("correlationId", event.correlationId());
    document.put("traceId", event.traceId());
    document.put("timestamp", event.timestamp().toString());
    return document;
  }

  public String redact(String message) {
    return delegate.redactText(message);
  }

  public boolean containsPii(String message) {
    return delegate.containsPii(message);
  }
}

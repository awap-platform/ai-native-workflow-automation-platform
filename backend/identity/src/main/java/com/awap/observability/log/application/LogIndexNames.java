package com.awap.observability.log.application;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/** Daily log index and dead-letter naming shared by the shipper, provisioner and search API. */
public final class LogIndexNames {

  public static final String DEFAULT_PREFIX = "awap-logs";

  private static final DateTimeFormatter DATE =
      DateTimeFormatter.ofPattern("yyyy.MM.dd").withZone(ZoneOffset.UTC);

  private final String prefix;

  public LogIndexNames(String prefix) {
    this.prefix = prefix == null || prefix.isBlank() ? DEFAULT_PREFIX : prefix;
  }

  public String dailyIndex(Instant timestamp) {
    return prefix + "-" + DATE.format(timestamp);
  }

  public String deadLetterIndex(Instant timestamp) {
    return prefix + "-dlq-" + DATE.format(timestamp);
  }

  public String pattern() {
    return prefix + "-*";
  }

  public String deadLetterPattern() {
    return prefix + "-dlq-*";
  }

  public String prefix() {
    return prefix;
  }
}

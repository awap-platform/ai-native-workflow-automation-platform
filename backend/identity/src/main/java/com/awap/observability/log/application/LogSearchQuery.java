package com.awap.observability.log.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import org.springframework.http.HttpStatus;

/** Validated log-search window and correlation filter (issue #286). */
public record LogSearchQuery(String correlationId, Instant from, Instant to, int limit) {

  public static final int DEFAULT_LIMIT = 50;
  public static final int MAX_LIMIT = 200;
  public static final int MAX_WINDOW_DAYS = 30;

  public static LogSearchQuery of(String correlationId, Instant from, Instant to, Integer limit) {
    Instant end = to == null ? Instant.now() : to;
    Instant start = from == null ? end.minus(Duration.ofDays(1)) : from;
    if (start.isAfter(end)) {
      throw badRequest("from must not be after to.");
    }
    if (Duration.between(start, end).toDays() > MAX_WINDOW_DAYS) {
      throw badRequest("The log search window must not exceed " + MAX_WINDOW_DAYS + " days.");
    }
    int effectiveLimit = limit == null ? DEFAULT_LIMIT : limit;
    if (effectiveLimit < 1 || effectiveLimit > MAX_LIMIT) {
      throw badRequest("limit must be between 1 and " + MAX_LIMIT + ".");
    }
    String normalized = correlationId == null ? "" : correlationId.trim().toLowerCase(Locale.ROOT);
    return new LogSearchQuery(normalized, start, end, effectiveLimit);
  }

  private static AwapException badRequest(String detail) {
    return new AwapException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, detail);
  }
}

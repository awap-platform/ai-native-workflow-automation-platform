package com.awap.analytics.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import org.springframework.http.HttpStatus;

/**
 * Validated query contract for the advanced analytics dashboard (issue #285).
 *
 * <p>All dates are interpreted in UTC. A range is bounded to 366 days so a single request cannot
 * scan or aggregate an unbounded history; the limit bounds every group/bottleneck ranking.
 */
public record AnalyticsDashboardQuery(
    LocalDate from, LocalDate to, Granularity granularity, GroupBy groupBy, int limit) {

  public static final int DEFAULT_WINDOW_DAYS = 7;
  public static final int MAX_WINDOW_DAYS = 366;
  public static final int DEFAULT_LIMIT = 10;
  public static final int MAX_LIMIT = 50;

  /** Time bucket size; WEEK starts on ISO Monday and MONTH on the first day of the month. */
  public enum Granularity {
    DAY,
    WEEK,
    MONTH
  }

  /** Dimension used for grouped summaries. */
  public enum GroupBy {
    EVENT_TYPE,
    NODE,
    WORKFLOW
  }

  public AnalyticsDashboardQuery {
    if (from == null || to == null) {
      throw new IllegalArgumentException("from and to are required");
    }
  }

  /** Parses and validates the raw HTTP parameters; every invalid input is a 400. */
  public static AnalyticsDashboardQuery of(
      LocalDate from, LocalDate to, String granularity, String groupBy, Integer limit) {
    LocalDate end = to == null ? LocalDate.now(ZoneOffset.UTC) : to;
    LocalDate start = from == null ? end.minusDays(DEFAULT_WINDOW_DAYS - 1L) : from;
    if (start.isAfter(end)) {
      throw badRequest("from must not be after to.");
    }
    if (ChronoUnit.DAYS.between(start, end) + 1 > MAX_WINDOW_DAYS) {
      throw badRequest("The analytics range must not exceed " + MAX_WINDOW_DAYS + " days.");
    }
    int effectiveLimit = limit == null ? DEFAULT_LIMIT : limit;
    if (effectiveLimit < 1 || effectiveLimit > MAX_LIMIT) {
      throw badRequest("limit must be between 1 and " + MAX_LIMIT + ".");
    }
    return new AnalyticsDashboardQuery(
        start, end, parseGranularity(granularity), parseGroupBy(groupBy), effectiveLimit);
  }

  private static Granularity parseGranularity(String value) {
    if (value == null || value.isBlank()) {
      return Granularity.DAY;
    }
    try {
      return Granularity.valueOf(value.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException ex) {
      throw badRequest("granularity must be one of DAY, WEEK or MONTH.");
    }
  }

  private static GroupBy parseGroupBy(String value) {
    if (value == null || value.isBlank()) {
      return GroupBy.EVENT_TYPE;
    }
    try {
      return GroupBy.valueOf(value.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException ex) {
      throw badRequest("groupBy must be one of EVENT_TYPE, NODE or WORKFLOW.");
    }
  }

  private static AwapException badRequest(String detail) {
    return new AwapException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, detail);
  }
}

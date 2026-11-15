package com.awap.analytics.interfaces.api;

import com.awap.analytics.application.AnalyticsAggregationService;
import com.awap.analytics.application.AnalyticsDashboard;
import com.awap.analytics.application.AnalyticsDashboardQuery;
import com.awap.analytics.application.AnalyticsService;
import com.awap.analytics.domain.AnalyticsAggregate;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.infrastructure.security.TenantContext;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Tenant-scoped process analytics summary used by the dashboard. */
@RestController
@RequestMapping("/api/v1/analytics")
public class AnalyticsController {

  private final AnalyticsService analyticsService;
  private final AnalyticsAggregationService aggregationService;

  public AnalyticsController(
      AnalyticsService analyticsService, AnalyticsAggregationService aggregationService) {
    this.analyticsService = analyticsService;
    this.aggregationService = aggregationService;
  }

  @GetMapping("/summary")
  @PreAuthorize("hasAuthority('INSTANCE_READ')")
  public ResponseEntity<List<AnalyticsAggregateResponse>> summary(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    LocalDate end = to == null ? LocalDate.now() : to;
    LocalDate start = from == null ? end.minusDays(6) : from;
    if (start.isAfter(end)) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "from must not be after to.");
    }
    return ResponseEntity.ok(
        analyticsService.summary(requireTenantId(), start, end).stream()
            .map(this::toResponse)
            .toList());
  }

  /** Advanced aggregations (issue #285): percentiles, rates, bottlenecks and trend windows. */
  @GetMapping("/dashboard")
  @PreAuthorize("hasAuthority('INSTANCE_READ')")
  public ResponseEntity<AnalyticsDashboard> dashboard(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) String granularity,
      @RequestParam(required = false) String groupBy,
      @RequestParam(required = false) Integer limit) {
    AnalyticsDashboardQuery query =
        AnalyticsDashboardQuery.of(from, to, granularity, groupBy, limit);
    return ResponseEntity.ok(aggregationService.dashboard(requireTenantId(), query));
  }

  private static UUID requireTenantId() {
    return TenantContext.current()
        .map(TenantContext.Context::tenantId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.UNAUTHORIZED,
                    HttpStatus.UNAUTHORIZED,
                    "Authentication is required."));
  }

  private AnalyticsAggregateResponse toResponse(AnalyticsAggregate aggregate) {
    long average =
        aggregate.getEventCount() == 0
            ? 0
            : aggregate.getTotalDurationMs() / aggregate.getEventCount();
    return new AnalyticsAggregateResponse(
        aggregate.getDay(),
        aggregate.getEventType(),
        aggregate.getEventCount(),
        aggregate.getTotalDurationMs(),
        average);
  }

  /** Public representation of one tenant/day event aggregate. */
  public record AnalyticsAggregateResponse(
      LocalDate day, String eventType, long count, long totalDurationMs, long averageDurationMs) {}
}

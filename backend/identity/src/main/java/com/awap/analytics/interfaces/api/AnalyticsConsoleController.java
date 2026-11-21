package com.awap.analytics.interfaces.api;

import com.awap.analytics.application.AnalyticsDashboard;
import com.awap.analytics.application.AnalyticsDashboardQuery;
import com.awap.analytics.application.AnalyticsDrilldown;
import com.awap.analytics.application.AnalyticsDrilldownService;
import com.awap.analytics.application.AnalyticsOverview;
import com.awap.analytics.application.AnalyticsOverviewService;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.infrastructure.security.TenantContext;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Phase 8 analytics console endpoints.
 *
 * <p>{@code /overview} is the single metric source for the cards and chart; {@code /drilldown}
 * pages the raw samples behind one event type; {@code /export} returns the bounded daily table as
 * CSV. All endpoints are tenant-scoped and require {@code INSTANCE_READ}.
 */
@RestController
@PreAuthorize("hasAuthority('INSTANCE_READ')")
@RequestMapping("/api/v1/analytics")
public class AnalyticsConsoleController {

  private final AnalyticsOverviewService overviewService;
  private final AnalyticsDrilldownService drilldownService;

  public AnalyticsConsoleController(
      AnalyticsOverviewService overviewService, AnalyticsDrilldownService drilldownService) {
    this.overviewService = overviewService;
    this.drilldownService = drilldownService;
  }

  @GetMapping("/overview")
  public ResponseEntity<AnalyticsOverview> overview(
      @RequestParam(name = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate from,
      @RequestParam(name = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate to,
      @RequestParam(name = "granularity", required = false) String granularity,
      @RequestParam(name = "groupBy", required = false) String groupBy,
      @RequestParam(name = "limit", required = false) Integer limit) {
    AnalyticsDashboardQuery query =
        AnalyticsDashboardQuery.of(from, to, granularity, groupBy, limit);
    return ResponseEntity.ok(overviewService.overview(requireTenantId(), query));
  }

  @GetMapping("/drilldown")
  public ResponseEntity<AnalyticsDrilldown> drilldown(
      @RequestParam(name = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate from,
      @RequestParam(name = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate to,
      @RequestParam(name = "eventType", required = false) String eventType,
      @RequestParam(name = "page", defaultValue = "0") int page,
      @RequestParam(name = "size", defaultValue = "20") int size) {
    return ResponseEntity.ok(
        drilldownService.drilldown(requireTenantId(), from, to, eventType, page, size));
  }

  @GetMapping("/export")
  public ResponseEntity<byte[]> export(
      @RequestParam(name = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate from,
      @RequestParam(name = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate to,
      @RequestParam(name = "granularity", required = false) String granularity,
      @RequestParam(name = "groupBy", required = false) String groupBy,
      @RequestParam(name = "limit", required = false) Integer limit) {
    AnalyticsDashboardQuery query =
        AnalyticsDashboardQuery.of(from, to, granularity, groupBy, limit);
    AnalyticsOverview overview = overviewService.overview(requireTenantId(), query);
    StringBuilder csv =
        new StringBuilder("day,eventType,count,totalDurationMs,averageDurationMs\n");
    for (AnalyticsDashboard.DailyTotal row : overview.dashboard().dailyTotals()) {
      csv.append(row.day())
          .append(',')
          .append(row.eventType())
          .append(',')
          .append(row.count())
          .append(',')
          .append(row.totalDurationMs())
          .append(',')
          .append(row.averageDurationMs())
          .append('\n');
    }
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"awap-analytics.csv\"")
        .header("X-AWAP-Export-Rows", Integer.toString(overview.dashboard().dailyTotals().size()))
        .body(csv.toString().getBytes(StandardCharsets.UTF_8));
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
}

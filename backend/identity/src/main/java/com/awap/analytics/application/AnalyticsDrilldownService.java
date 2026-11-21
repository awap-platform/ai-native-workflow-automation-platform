package com.awap.analytics.application;

import com.awap.analytics.domain.AnalyticsEventSample;
import com.awap.analytics.infrastructure.AnalyticsEventSampleRepository;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Tenant-scoped drill-down over the bounded raw analytics samples.
 *
 * <p>The date window is validated by {@link AnalyticsDashboardQuery}, so the drill-down and the
 * dashboard reject the same inverted or oversized ranges. A read failure is returned as an explicit
 * partial response rather than an empty list.
 */
@Service
public class AnalyticsDrilldownService {

  public static final int MAX_PAGE_SIZE = 50;

  private final AnalyticsEventSampleRepository sampleRepository;

  public AnalyticsDrilldownService(AnalyticsEventSampleRepository sampleRepository) {
    this.sampleRepository = sampleRepository;
  }

  @Transactional(readOnly = true, timeout = 5)
  public AnalyticsDrilldown drilldown(
      UUID tenantId, LocalDate from, LocalDate to, String eventType, int page, int size) {
    AnalyticsDashboardQuery window = AnalyticsDashboardQuery.of(from, to, "DAY", "EVENT_TYPE", 10);
    if (page < 0) {
      throw badRequest("page must be zero or greater.");
    }
    if (size < 1 || size > MAX_PAGE_SIZE) {
      throw badRequest("size must be between 1 and " + MAX_PAGE_SIZE + ".");
    }
    String filter =
        eventType == null || eventType.isBlank() ? null : eventType.trim().toUpperCase(Locale.ROOT);
    Pageable pageable =
        PageRequest.of(page, size, Sort.by(Sort.Order.desc("occurredAt"), Sort.Order.desc("id")));
    try {
      Page<AnalyticsEventSample> result =
          filter == null
              ? sampleRepository.findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(
                  tenantId,
                  window.from().atStartOfDay(ZoneOffset.UTC).toInstant(),
                  window.to().plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant(),
                  pageable)
              : sampleRepository
                  .findByTenantIdAndEventTypeAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(
                      tenantId,
                      filter,
                      window.from().atStartOfDay(ZoneOffset.UTC).toInstant(),
                      window.to().plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant(),
                      pageable);
      return new AnalyticsDrilldown(
          window.from(),
          window.to(),
          filter,
          page,
          size,
          result.getTotalElements(),
          result.getTotalPages(),
          false,
          null,
          result.getContent().stream()
              .map(
                  sample ->
                      new AnalyticsDrilldown.Row(
                          sample.getId(),
                          sample.getEventType(),
                          sample.getWorkflowInstanceId(),
                          sample.getTaskId(),
                          sample.getNodeId(),
                          sample.getDurationMs(),
                          sample.getOccurredAt()))
              .toList());
    } catch (DataAccessException ex) {
      return new AnalyticsDrilldown(
          window.from(),
          window.to(),
          filter,
          page,
          size,
          0,
          0,
          true,
          "The raw-event source is unavailable; drill-down rows cannot be shown.",
          List.of());
    }
  }

  private static AwapException badRequest(String detail) {
    return new AwapException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, detail);
  }
}

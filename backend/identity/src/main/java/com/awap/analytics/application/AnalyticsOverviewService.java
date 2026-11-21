package com.awap.analytics.application;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Builds the single analytics overview projection used by the Phase 8 screen. */
@Service
public class AnalyticsOverviewService {

  private final AnalyticsAggregationService aggregationService;

  public AnalyticsOverviewService(AnalyticsAggregationService aggregationService) {
    this.aggregationService = aggregationService;
  }

  @Transactional(readOnly = true, timeout = 5)
  public AnalyticsOverview overview(UUID tenantId, AnalyticsDashboardQuery query) {
    return AnalyticsOverview.of(aggregationService.dashboard(tenantId, query));
  }
}

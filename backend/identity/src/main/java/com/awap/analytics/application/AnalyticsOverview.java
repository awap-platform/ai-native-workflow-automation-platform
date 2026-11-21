package com.awap.analytics.application;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Single server-side metric source for the Phase 8 analytics screen.
 *
 * <p>The cards, the chart and the drill-down all read this projection. Event totals are folded from
 * the authoritative {@code dailyTotals} by the backend, so the browser never recomputes a count
 * that could disagree with the API.
 */
public record AnalyticsOverview(
    AnalyticsDashboard dashboard, List<EventTotal> eventTotals, long totalEvents) {

  /** One tenant/window event type total. */
  public record EventTotal(
      String eventType, long count, long totalDurationMs, long averageDurationMs) {}

  /** Folds the daily totals into one row per event type, preserving a stable key order. */
  public static AnalyticsOverview of(AnalyticsDashboard dashboard) {
    Map<String, long[]> totals = new LinkedHashMap<>();
    for (AnalyticsDashboard.DailyTotal daily : dashboard.dailyTotals()) {
      long[] values = totals.computeIfAbsent(daily.eventType(), key -> new long[2]);
      values[0] += daily.count();
      values[1] += daily.totalDurationMs();
    }
    List<EventTotal> eventTotals = new ArrayList<>(totals.size());
    long totalEvents = 0;
    for (Map.Entry<String, long[]> entry : totals.entrySet()) {
      long count = entry.getValue()[0];
      long duration = entry.getValue()[1];
      totalEvents += count;
      eventTotals.add(
          new EventTotal(entry.getKey(), count, duration, count == 0 ? 0 : duration / count));
    }
    eventTotals.sort((left, right) -> left.eventType().compareTo(right.eventType()));
    return new AnalyticsOverview(dashboard, List.copyOf(eventTotals), totalEvents);
  }
}

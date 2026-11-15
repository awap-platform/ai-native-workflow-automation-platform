package com.awap.analytics.application;

import com.awap.analytics.domain.AnalyticsAggregate;
import com.awap.analytics.domain.AnalyticsEventSample;
import com.awap.analytics.infrastructure.AnalyticsAggregateRepository;
import com.awap.analytics.infrastructure.AnalyticsEventSampleRepository;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Builds the advanced analytics dashboard from the authoritative daily aggregates and the bounded
 * raw-event samples (issue #285).
 *
 * <p>The query is read-only with a hard transaction timeout so an expensive range cannot exhaust a
 * database connection. When the raw-event source is unavailable the response is explicitly marked
 * partial rather than returning invented percentiles.
 */
@Service
public class AnalyticsAggregationService {

  private static final Set<String> WORKFLOW_DURATION_TYPES = Set.of("WORKFLOW_COMPLETED");
  private static final Set<String> TASK_CYCLE_TYPES = Set.of("TASK_COMPLETED");
  private static final Set<String> APPROVAL_LATENCY_TYPES = Set.of("APPROVAL_COMPLETED");

  private final AnalyticsAggregateRepository aggregateRepository;
  private final AnalyticsEventSampleRepository sampleRepository;

  @Autowired
  public AnalyticsAggregationService(
      AnalyticsAggregateRepository aggregateRepository,
      AnalyticsEventSampleRepository sampleRepository) {
    this.aggregateRepository = aggregateRepository;
    this.sampleRepository = sampleRepository;
  }

  @Transactional(readOnly = true, timeout = 5)
  public AnalyticsDashboard dashboard(UUID tenantId, AnalyticsDashboardQuery query) {
    List<AnalyticsAggregate> aggregates = loadAggregates(tenantId, query);
    List<AnalyticsEventSample> samples = loadSamples(tenantId, query);
    long previousCount = loadPreviousCount(tenantId, query);

    List<AnalyticsDashboard.DailyTotal> dailyTotals = toDailyTotals(aggregates);
    return new AnalyticsDashboard(
        query.from(),
        query.to(),
        query.granularity().name(),
        "UTC",
        new AnalyticsDashboard.DataCompleteness(
            aggregateRepository != null, sampleRepository != null, samples.size()),
        dailyTotals,
        toTimeBuckets(dailyTotals, query.granularity()),
        percentileSet(samples, WORKFLOW_DURATION_TYPES),
        percentileSet(samples, TASK_CYCLE_TYPES),
        percentileSet(samples, APPROVAL_LATENCY_TYPES),
        rate(
            dailyTotals,
            Set.of("WORKFLOW_FAILED"),
            Set.of("WORKFLOW_COMPLETED", "WORKFLOW_FAILED")),
        rate(dailyTotals, Set.of("SLA_BREACHED"), allEventTypes(dailyTotals)),
        bottlenecks(samples, query.limit()),
        groups(samples, query.groupBy(), query.limit()),
        new AnalyticsDashboard.Trend(
            samples.size(), previousCount, samples.size() - previousCount));
  }

  private List<AnalyticsAggregate> loadAggregates(UUID tenantId, AnalyticsDashboardQuery query) {
    if (aggregateRepository == null) {
      return List.of();
    }
    return aggregateRepository.findByTenantIdAndDayBetweenOrderByDayAscEventTypeAsc(
        tenantId, query.from(), query.to());
  }

  private List<AnalyticsEventSample> loadSamples(UUID tenantId, AnalyticsDashboardQuery query) {
    if (sampleRepository == null) {
      return List.of();
    }
    return sampleRepository
        .findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
            tenantId, startOfDay(query.from()), startOfDay(query.to().plusDays(1)));
  }

  private long loadPreviousCount(UUID tenantId, AnalyticsDashboardQuery query) {
    if (sampleRepository == null) {
      return 0L;
    }
    long windowDays = ChronoUnit.DAYS.between(query.from(), query.to()) + 1;
    LocalDate previousFrom = query.from().minusDays(windowDays);
    return sampleRepository
        .findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
            tenantId, startOfDay(previousFrom), startOfDay(query.from()))
        .size();
  }

  private static Instant startOfDay(LocalDate day) {
    return day.atStartOfDay(ZoneOffset.UTC).toInstant();
  }

  private static List<AnalyticsDashboard.DailyTotal> toDailyTotals(
      List<AnalyticsAggregate> aggregates) {
    List<AnalyticsDashboard.DailyTotal> totals = new ArrayList<>(aggregates.size());
    for (AnalyticsAggregate aggregate : aggregates) {
      long count = aggregate.getEventCount();
      long average = count == 0 ? 0 : aggregate.getTotalDurationMs() / count;
      totals.add(
          new AnalyticsDashboard.DailyTotal(
              aggregate.getDay(),
              aggregate.getEventType(),
              count,
              aggregate.getTotalDurationMs(),
              average));
    }
    return totals;
  }

  private static Set<String> allEventTypes(List<AnalyticsDashboard.DailyTotal> totals) {
    return totals.stream()
        .map(AnalyticsDashboard.DailyTotal::eventType)
        .collect(Collectors.toSet());
  }

  private static double rate(
      List<AnalyticsDashboard.DailyTotal> totals, Set<String> numerator, Set<String> denominator) {
    long top = 0;
    long bottom = 0;
    for (AnalyticsDashboard.DailyTotal total : totals) {
      if (numerator.contains(total.eventType())) {
        top += total.count();
      }
      if (denominator.contains(total.eventType())) {
        bottom += total.count();
      }
    }
    return bottom == 0 ? 0.0 : round4((double) top / bottom);
  }

  private static double round4(double value) {
    return Math.round(value * 10_000.0) / 10_000.0;
  }

  private static List<AnalyticsDashboard.TimeBucket> toTimeBuckets(
      List<AnalyticsDashboard.DailyTotal> totals, AnalyticsDashboardQuery.Granularity granularity) {
    Map<LocalDate, Map<String, Long>> bucketCounts = new LinkedHashMap<>();
    Map<LocalDate, Long> bucketTotals = new LinkedHashMap<>();
    totals.stream()
        .sorted(
            Comparator.comparing(AnalyticsDashboard.DailyTotal::day)
                .thenComparing(AnalyticsDashboard.DailyTotal::eventType))
        .forEach(
            total -> {
              LocalDate bucket = bucketFor(total.day(), granularity);
              bucketCounts
                  .computeIfAbsent(bucket, key -> new LinkedHashMap<>())
                  .merge(total.eventType(), total.count(), Long::sum);
              bucketTotals.merge(bucket, total.count(), Long::sum);
            });
    List<AnalyticsDashboard.TimeBucket> buckets = new ArrayList<>(bucketCounts.size());
    bucketCounts.forEach(
        (bucket, counts) ->
            buckets.add(
                new AnalyticsDashboard.TimeBucket(
                    bucket.toString(), bucketTotals.getOrDefault(bucket, 0L), counts)));
    return buckets;
  }

  private static LocalDate bucketFor(
      LocalDate day, AnalyticsDashboardQuery.Granularity granularity) {
    return switch (granularity) {
      case DAY -> day;
      case WEEK -> day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
      case MONTH -> day.withDayOfMonth(1);
    };
  }

  private static AnalyticsDashboard.PercentileSet percentileSet(
      List<AnalyticsEventSample> samples, Set<String> types) {
    List<Long> durations =
        samples.stream()
            .filter(sample -> types.contains(sample.getEventType()))
            .map(AnalyticsEventSample::getDurationMs)
            .sorted()
            .toList();
    if (durations.isEmpty()) {
      return AnalyticsDashboard.PercentileSet.empty();
    }
    return new AnalyticsDashboard.PercentileSet(
        percentile(durations, 50.0),
        percentile(durations, 90.0),
        percentile(durations, 95.0),
        percentile(durations, 99.0),
        durations.size());
  }

  /** Nearest-rank percentile over an ascending list. */
  static Long percentile(List<Long> ascending, double p) {
    if (ascending.isEmpty()) {
      return null;
    }
    int index = (int) Math.ceil(p / 100.0 * ascending.size()) - 1;
    return ascending.get(Math.max(0, Math.min(index, ascending.size() - 1)));
  }

  private static List<AnalyticsDashboard.Bottleneck> bottlenecks(
      List<AnalyticsEventSample> samples, int limit) {
    Map<String, List<Long>> byNode = new LinkedHashMap<>();
    for (AnalyticsEventSample sample : samples) {
      String node = sample.getNodeId();
      if (node != null && !node.isBlank()) {
        byNode.computeIfAbsent(node, key -> new ArrayList<>()).add(sample.getDurationMs());
      }
    }
    return byNode.entrySet().stream()
        .map(
            entry -> {
              List<Long> durations = entry.getValue().stream().sorted().toList();
              long average =
                  (long) durations.stream().mapToLong(Long::longValue).average().orElse(0.0);
              Long p95 = percentile(durations, 95.0);
              return new AnalyticsDashboard.Bottleneck(
                  entry.getKey(), durations.size(), average, p95 == null ? 0L : p95);
            })
        .sorted(
            Comparator.comparingLong(AnalyticsDashboard.Bottleneck::averageDurationMs)
                .reversed()
                .thenComparing(AnalyticsDashboard.Bottleneck::nodeId))
        .limit(limit)
        .toList();
  }

  private static List<AnalyticsDashboard.GroupSummary> groups(
      List<AnalyticsEventSample> samples, AnalyticsDashboardQuery.GroupBy groupBy, int limit) {
    Map<String, List<Long>> byGroup = new LinkedHashMap<>();
    for (AnalyticsEventSample sample : samples) {
      String key = groupKey(sample, groupBy);
      if (key != null && !key.isBlank()) {
        byGroup.computeIfAbsent(key, ignored -> new ArrayList<>()).add(sample.getDurationMs());
      }
    }
    return byGroup.entrySet().stream()
        .map(
            entry -> {
              List<Long> durations = entry.getValue().stream().sorted().toList();
              long average =
                  (long) durations.stream().mapToLong(Long::longValue).average().orElse(0.0);
              Long p95 = percentile(durations, 95.0);
              return new AnalyticsDashboard.GroupSummary(
                  entry.getKey(), durations.size(), average, p95 == null ? 0L : p95);
            })
        .sorted(
            Comparator.comparingLong(AnalyticsDashboard.GroupSummary::count)
                .reversed()
                .thenComparing(AnalyticsDashboard.GroupSummary::key))
        .limit(limit)
        .toList();
  }

  private static String groupKey(
      AnalyticsEventSample sample, AnalyticsDashboardQuery.GroupBy groupBy) {
    return switch (groupBy) {
      case EVENT_TYPE -> sample.getEventType();
      case NODE -> sample.getNodeId();
      case WORKFLOW ->
          sample.getWorkflowInstanceId() == null ? null : sample.getWorkflowInstanceId().toString();
    };
  }
}

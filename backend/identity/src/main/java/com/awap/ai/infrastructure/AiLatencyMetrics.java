package com.awap.ai.infrastructure;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.UUID;

/**
 * AI-specific Micrometer timers (issue #290).
 *
 * <p>AI latency is measured separately from the platform HTTP SLO so a slow model can never hide
 * behind, or pollute, the non-AI P95. Tenant identity is reduced to ten buckets to keep the tag
 * cardinality bounded; tier, action, outcome and cache-hit are naturally bounded enums.
 */
public final class AiLatencyMetrics {

  static final String REQUEST_TIMER = "awap.ai.request.duration";
  static final String PROVIDER_TIMER = "awap.ai.provider.duration";
  static final String QUEUE_WAIT_TIMER = "awap.ai.job.queue.wait";
  static final int TENANT_BUCKETS = 10;

  private AiLatencyMetrics() {}

  /** Records one Copilot request, including cache hits (which are low-latency successes). */
  public static void recordRequest(
      MeterRegistry registry,
      long durationNanos,
      String tier,
      String action,
      String outcome,
      boolean cacheHit,
      UUID tenantId) {
    Timer.builder(REQUEST_TIMER)
        .tags(
            "tier",
            orDefault(tier, "none"),
            "action",
            orDefault(action, "unknown"),
            "outcome",
            orDefault(outcome, "ERROR"),
            "cache",
            cacheHit ? "hit" : "miss",
            "tenant",
            tenantBucket(tenantId))
        .publishPercentileHistogram()
        .register(registry)
        .record(nonNegative(durationNanos));
  }

  /** Records the provider round trip, tagged by the routed model and its result. */
  public static void recordProvider(
      MeterRegistry registry, long durationNanos, String model, String result) {
    Timer.builder(PROVIDER_TIMER)
        .tags("model", orDefault(model, "unknown"), "result", orDefault(result, "error"))
        .publishPercentileHistogram()
        .register(registry)
        .record(nonNegative(durationNanos));
  }

  /** Records how long a job waited between submission and the first execution attempt. */
  public static void recordQueueWait(MeterRegistry registry, long millis) {
    Timer.builder(QUEUE_WAIT_TIMER)
        .publishPercentileHistogram()
        .register(registry)
        .record(Duration.ofMillis(Math.max(0L, millis)));
  }

  /** Ten stable tenant buckets instead of the raw tenant id. */
  static String tenantBucket(UUID tenantId) {
    return tenantId == null ? "t0" : "t" + Math.floorMod(tenantId.hashCode(), TENANT_BUCKETS);
  }

  private static Duration nonNegative(long durationNanos) {
    return durationNanos >= 0 ? Duration.ofNanos(durationNanos) : Duration.ZERO;
  }

  private static String orDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }
}

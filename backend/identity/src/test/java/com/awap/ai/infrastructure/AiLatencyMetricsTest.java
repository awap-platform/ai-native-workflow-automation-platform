package com.awap.ai.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/** AI latency meters must be named, tagged and bounded exactly as the dashboard expects. */
class AiLatencyMetricsTest {

  private final SimpleMeterRegistry registry = new SimpleMeterRegistry();

  @Test
  void recordsTheRequestTimerWithBoundedTags() {
    UUID tenant = UUID.randomUUID();

    AiLatencyMetrics.recordRequest(
        registry, Duration.ofMillis(25).toNanos(), "standard", "chat", "SUCCESS", true, tenant);

    Timer timer =
        registry
            .get(AiLatencyMetrics.REQUEST_TIMER)
            .tags(
                "tier",
                "standard",
                "action",
                "chat",
                "outcome",
                "SUCCESS",
                "cache",
                "hit",
                "tenant",
                AiLatencyMetrics.tenantBucket(tenant))
            .timer();
    assertThat(timer.count()).isEqualTo(1);
    assertThat(timer.max(TimeUnit.NANOSECONDS))
        .isGreaterThanOrEqualTo(Duration.ofMillis(25).toNanos());
    assertThat(registry.get(AiLatencyMetrics.REQUEST_TIMER).tag("cache", "hit").timer().count())
        .isEqualTo(1);
  }

  @Test
  void nullAndBlankTagsUseBoundedDefaults() {
    AiLatencyMetrics.recordRequest(registry, 0, null, " ", null, false, null);

    Timer timer =
        registry
            .get(AiLatencyMetrics.REQUEST_TIMER)
            .tags(
                "tier", "none", "action", "unknown", "outcome", "ERROR", "cache", "miss", "tenant",
                "t0")
            .timer();
    assertThat(timer.count()).isEqualTo(1);
  }

  @Test
  void negativeDurationsAreClampedToZero() {
    AiLatencyMetrics.recordRequest(registry, -1, "cheap", "chat", "SUCCESS", false, null);
    AiLatencyMetrics.recordProvider(registry, -1, "gpt", "success");
    AiLatencyMetrics.recordQueueWait(registry, -5);

    assertThat(registry.get(AiLatencyMetrics.REQUEST_TIMER).timer().count()).isEqualTo(1);
    assertThat(registry.get(AiLatencyMetrics.PROVIDER_TIMER).timer().count()).isEqualTo(1);
    assertThat(registry.get(AiLatencyMetrics.QUEUE_WAIT_TIMER).timer().count()).isEqualTo(1);
  }

  @Test
  void providerTimerUsesModelAndResultTags() {
    AiLatencyMetrics.recordProvider(registry, Duration.ofMillis(5).toNanos(), "gpt", "success");

    assertThat(
            registry
                .get(AiLatencyMetrics.PROVIDER_TIMER)
                .tags("model", "gpt", "result", "success")
                .timer()
                .count())
        .isEqualTo(1);

    AiLatencyMetrics.recordProvider(registry, 0, " ", null);

    assertThat(
            registry
                .get(AiLatencyMetrics.PROVIDER_TIMER)
                .tags("model", "unknown", "result", "error")
                .timer()
                .count())
        .isEqualTo(1);
  }

  @Test
  void tenantBucketsAreStableAndBounded() {
    UUID tenant = UUID.fromString("00000000-0000-0000-0000-000000000001");

    assertThat(AiLatencyMetrics.tenantBucket(tenant))
        .isEqualTo(AiLatencyMetrics.tenantBucket(tenant))
        .startsWith("t")
        .hasSize(2);
    assertThat(AiLatencyMetrics.tenantBucket(null)).isEqualTo("t0");
  }
}

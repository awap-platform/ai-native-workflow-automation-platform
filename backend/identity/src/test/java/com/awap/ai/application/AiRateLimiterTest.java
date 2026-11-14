package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AiRateLimiterTest {

  private final UUID tenantId = UUID.randomUUID();

  @Test
  void allowsRequestsUpToTheWindowLimit() {
    AiRateLimiter limiter =
        new AiRateLimiter(2, Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC));

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isFalse();
    assertThat(limiter.limitPerMinute()).isEqualTo(2);
  }

  @Test
  void limitsAreIsolatedPerTenant() {
    AiRateLimiter limiter =
        new AiRateLimiter(1, Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC));

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(UUID.randomUUID())).isTrue();
  }

  @Test
  void requestsOlderThanTheWindowArePruned() {
    MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
    AiRateLimiter limiter = new AiRateLimiter(1, clock);

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isFalse();

    clock.advance(Duration.ofSeconds(61));

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
  }

  /** Controllable clock so the sliding window can be advanced without sleeping. */
  private static final class MutableClock extends Clock {

    private Instant instant;

    private MutableClock(Instant instant) {
      this.instant = instant;
    }

    private void advance(Duration duration) {
      instant = instant.plus(duration);
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return instant;
    }
  }
}

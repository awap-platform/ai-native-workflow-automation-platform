package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
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
  }

  @Test
  void limitsAreIsolatedPerTenant() {
    AiRateLimiter limiter =
        new AiRateLimiter(1, Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC));

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(UUID.randomUUID())).isTrue();
  }
}

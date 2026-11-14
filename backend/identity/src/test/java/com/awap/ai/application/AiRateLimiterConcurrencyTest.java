package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * C4: the per-tenant sliding-window limiter under real concurrency.
 *
 * <p>Every burst uses a fixed clock, a {@link CyclicBarrier} and a multi-threaded executor. No test
 * sleeps; the clock is advanced explicitly. The executor thread names are collected so a
 * single-threaded regression cannot silently pass.
 */
class AiRateLimiterConcurrencyTest {

  private static final Instant NOW = Instant.parse("2026-01-01T00:00:00Z");
  private final UUID tenantId = UUID.randomUUID();

  @Test
  void concurrentBurstAdmitsExactlyTheLimit() throws Exception {
    int limit = 20;
    int callers = 64;
    AiRateLimiter limiter = new AiRateLimiter(limit, Clock.fixed(NOW, ZoneOffset.UTC));
    AtomicInteger admitted = new AtomicInteger();
    AtomicInteger rejected = new AtomicInteger();
    Map<String, Boolean> threads = new ConcurrentHashMap<>();

    BurstResult result =
        runBurst(
            callers,
            index -> {
              threads.put(Thread.currentThread().getName(), Boolean.TRUE);
              if (limiter.tryAcquire(tenantId)) {
                admitted.incrementAndGet();
              } else {
                rejected.incrementAndGet();
              }
            });

    assertThat(result.threadCount()).isGreaterThan(1);
    assertThat(threads).hasSizeGreaterThan(1);
    assertThat(admitted.get()).isEqualTo(limit);
    assertThat(rejected.get()).isEqualTo(callers - limit);
    assertThat(admitted.get() + rejected.get()).isEqualTo(callers);
  }

  @Test
  void tenantsBurstIndependently() throws Exception {
    int limit = 5;
    int perTenantCallers = 32;
    UUID tenantA = UUID.randomUUID();
    UUID tenantB = UUID.randomUUID();
    AiRateLimiter limiter = new AiRateLimiter(limit, Clock.fixed(NOW, ZoneOffset.UTC));
    AtomicInteger admittedA = new AtomicInteger();
    AtomicInteger admittedB = new AtomicInteger();
    AtomicInteger rejectedA = new AtomicInteger();
    AtomicInteger rejectedB = new AtomicInteger();

    runBurst(
        perTenantCallers * 2,
        index -> {
          UUID tenant = index % 2 == 0 ? tenantA : tenantB;
          boolean acquired = limiter.tryAcquire(tenant);
          if (tenant.equals(tenantA)) {
            if (acquired) {
              admittedA.incrementAndGet();
            } else {
              rejectedA.incrementAndGet();
            }
          } else if (acquired) {
            admittedB.incrementAndGet();
          } else {
            rejectedB.incrementAndGet();
          }
        });

    assertThat(admittedA.get()).isEqualTo(limit);
    assertThat(admittedB.get()).isEqualTo(limit);
    assertThat(rejectedA.get()).isEqualTo(perTenantCallers - limit);
    assertThat(rejectedB.get()).isEqualTo(perTenantCallers - limit);
  }

  @Test
  void randomizedInterleavingsNeverExceedTheLimitPerTenant() throws Exception {
    int limit = 4;
    int perTenantCallers = 16;
    UUID[] tenants = {UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID()};
    AiRateLimiter limiter = new AiRateLimiter(limit, Clock.fixed(NOW, ZoneOffset.UTC));
    Map<UUID, AtomicInteger> admitted = new ConcurrentHashMap<>();
    for (UUID tenant : tenants) {
      admitted.put(tenant, new AtomicInteger());
    }

    runBurst(
        perTenantCallers * tenants.length,
        index -> {
          // Deterministic pseudo-random spread across tenants without sleeping.
          UUID tenant = tenants[(index * 7 + index / 3) % tenants.length];
          if (limiter.tryAcquire(tenant)) {
            admitted.get(tenant).incrementAndGet();
          }
        });

    for (UUID tenant : tenants) {
      assertThat(admitted.get(tenant).get()).isLessThanOrEqualTo(limit);
      assertThat(admitted.get(tenant).get()).isEqualTo(limit);
    }
  }

  @Test
  void windowAdvancesAndAdmitsAgain() {
    MutableClock clock = new MutableClock(NOW);
    AiRateLimiter limiter = new AiRateLimiter(3, clock);

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isFalse();

    clock.advance(Duration.ofSeconds(61));

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isFalse();
  }

  @Test
  void cutoffIsInclusiveAndOneMillisecondLaterPrunes() {
    MutableClock clock = new MutableClock(NOW);
    AiRateLimiter limiter = new AiRateLimiter(1, clock);

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    clock.set(NOW.plusSeconds(60));
    // The entry sits exactly on the cutoff and is retained: size == limit rejects.
    assertThat(limiter.tryAcquire(tenantId)).isFalse();

    clock.set(NOW.plusSeconds(60).plusMillis(1));
    assertThat(limiter.tryAcquire(tenantId)).isTrue();
  }

  @Test
  void clockMovingBackwardFailsSafeAndRecovers() {
    MutableClock clock = new MutableClock(NOW.plusSeconds(60));
    AiRateLimiter limiter = new AiRateLimiter(2, clock);

    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isTrue();

    clock.set(NOW);
    assertThat(limiter.tryAcquire(tenantId)).isFalse();

    clock.set(NOW.plusSeconds(121));
    assertThat(limiter.tryAcquire(tenantId)).isTrue();
  }

  @Test
  void interruptedThreadPreservesTheInterruptFlagAndWindow() {
    AiRateLimiter limiter = new AiRateLimiter(1, Clock.fixed(NOW, ZoneOffset.UTC));
    Thread.currentThread().interrupt();
    try {
      assertThat(limiter.tryAcquire(tenantId)).isTrue();
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
    // The interrupt did not corrupt the window: the second call is still rejected.
    assertThat(limiter.tryAcquire(tenantId)).isFalse();
  }

  @Test
  void negativeLimitIsClampedToAtLeastOne() {
    AiRateLimiter limiter = new AiRateLimiter(-10, Clock.fixed(NOW, ZoneOffset.UTC));
    assertThat(limiter.limitPerMinute()).isEqualTo(1);
    assertThat(limiter.tryAcquire(tenantId)).isTrue();
    assertThat(limiter.tryAcquire(tenantId)).isFalse();
  }

  private static BurstResult runBurst(int callers, java.util.function.IntConsumer body)
      throws Exception {
    java.util.concurrent.ThreadPoolExecutor pool =
        (java.util.concurrent.ThreadPoolExecutor) Executors.newFixedThreadPool(callers);
    CyclicBarrier barrier = new CyclicBarrier(callers);
    List<Callable<Void>> tasks = new ArrayList<>();
    for (int index = 0; index < callers; index++) {
      int taskIndex = index;
      tasks.add(
          () -> {
            barrier.await(10, TimeUnit.SECONDS);
            body.accept(taskIndex);
            return null;
          });
    }
    try {
      for (Future<Void> future : pool.invokeAll(tasks)) {
        future.get(15, TimeUnit.SECONDS);
      }
      int threadCount = pool.getPoolSize();
      return new BurstResult(threadCount);
    } finally {
      pool.shutdownNow();
    }
  }

  private record BurstResult(int threadCount) {}

  /** Controllable clock so the window can move without sleeping. */
  private static final class MutableClock extends Clock {

    private Instant instant;

    private MutableClock(Instant instant) {
      this.instant = instant;
    }

    private void advance(Duration duration) {
      instant = instant.plus(duration);
    }

    private void set(Instant value) {
      instant = value;
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

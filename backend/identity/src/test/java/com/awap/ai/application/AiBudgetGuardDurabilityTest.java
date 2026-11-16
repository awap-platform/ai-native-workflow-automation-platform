package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.awap.common.api.AwapException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Durable monthly AI budget semantics (issue #301). */
class AiBudgetGuardDurabilityTest {

  private final UUID tenant = UUID.randomUUID();
  private final AiBudgetGuard.InMemoryBudgetStore sharedStore =
      new AiBudgetGuard.InMemoryBudgetStore();

  @Test
  void aSecondReplicaSharesTheSameLedger() {
    AiBudgetGuard replicaA = guard(100, sharedStore, clock("2026-03-10T10:00:00Z"));
    AiBudgetGuard replicaB = guard(100, sharedStore, clock("2026-03-10T10:00:00Z"));

    assertThat(replicaA.reserve(tenant, 60)).isTrue();
    assertThat(replicaB.used(tenant)).isEqualTo(60);
    assertThat(replicaB.reserve(tenant, 40)).isTrue();
    assertThat(replicaA.reserve(tenant, 1)).isFalse();
    assertThat(replicaB.remaining(tenant)).isZero();
  }

  @Test
  void aRestartPreservesUsageBecauseTheStoreOwnsTheLedger() {
    AiBudgetGuard beforeRestart = guard(100, sharedStore, clock("2026-03-10T10:00:00Z"));
    assertThat(beforeRestart.reserve(tenant, 75)).isTrue();

    AiBudgetGuard afterRestart = guard(100, sharedStore, clock("2026-03-10T12:00:00Z"));

    assertThat(afterRestart.used(tenant)).isEqualTo(75);
    assertThat(afterRestart.reserve(tenant, 30)).isFalse();
  }

  @Test
  void aNewUtcMonthStartsAFreshBudgetWindow() {
    MutableClock clock = new MutableClock(Instant.parse("2026-01-31T23:59:00Z"));
    AiBudgetGuard guard = guard(100, sharedStore, clock);

    assertThat(guard.period()).isEqualTo(LocalDate.of(2026, 1, 1));
    assertThat(guard.reserve(tenant, 100)).isTrue();
    assertThat(guard.reserve(tenant, 1)).isFalse();

    clock.set(Instant.parse("2026-02-01T00:00:01Z"));

    assertThat(guard.period()).isEqualTo(LocalDate.of(2026, 2, 1));
    assertThat(guard.used(tenant)).isZero();
    assertThat(guard.reserve(tenant, 100)).isTrue();
  }

  @Test
  void aDuplicateEventKeyIsIdempotent() {
    AiBudgetGuard guard = guard(100, sharedStore, clock("2026-03-10T10:00:00Z"));

    assertThat(guard.reserve(tenant, 20, "duplicate-key")).isTrue();
    assertThat(guard.reserve(tenant, 20, "duplicate-key")).isTrue();

    assertThat(guard.used(tenant)).isEqualTo(20);
  }

  @Test
  void concurrentReservationsCannotExceedTheCap() throws Exception {
    AiBudgetGuard guard = guard(100, sharedStore, clock("2026-03-10T10:00:00Z"));
    int attempts = 40;
    ExecutorService pool = Executors.newFixedThreadPool(attempts);
    CountDownLatch start = new CountDownLatch(1);
    AtomicInteger admitted = new AtomicInteger();

    try {
      for (int index = 0; index < attempts; index++) {
        pool.submit(
            () -> {
              try {
                start.await(10, TimeUnit.SECONDS);
                if (guard.reserve(tenant, 10)) {
                  admitted.incrementAndGet();
                }
              } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
              }
            });
      }
      start.countDown();
      pool.shutdown();
      assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
    } finally {
      pool.shutdownNow();
    }

    assertThat(admitted.get()).isEqualTo(10);
    assertThat(guard.used(tenant)).isEqualTo(100);
  }

  @Test
  void refundAndReconciliationAdjustTheLedger() {
    AiBudgetGuard guard = guard(200, sharedStore, clock("2026-03-10T10:00:00Z"));

    assertThat(guard.reserve(tenant, 100)).isTrue();
    guard.refund(tenant, 30);
    guard.refund(tenant, 30, "refund-key");
    guard.refund(tenant, 30, "refund-key");
    assertThat(guard.used(tenant)).isEqualTo(40);

    guard.commit(tenant, 100, 40);
    assertThat(guard.used(tenant)).isZero();
  }

  @Test
  void aStoreFailureIsFailClosed() {
    AiBudgetStore broken =
        new AiBudgetStore() {
          @Override
          public ReservationResult reserve(
              String eventKey, UUID tenantId, LocalDate period, int tokens, long limit) {
            throw new IllegalStateException("database unavailable");
          }

          @Override
          public long refund(String eventKey, UUID tenantId, LocalDate period, int tokens) {
            return 0;
          }

          @Override
          public long reconcile(
              UUID tenantId, LocalDate period, int estimatedTokens, int actualTokens) {
            return 0;
          }

          @Override
          public BudgetSnapshot snapshot(UUID tenantId, LocalDate period, long budgetTokens) {
            return new BudgetSnapshot(tenantId, period, 0, 0, budgetTokens);
          }

          @Override
          public void reset(UUID tenantId, LocalDate period) {}
        };
    AiBudgetGuard guard =
        new AiBudgetGuard(100, broken, clock("2026-03-10T10:00:00Z"), new SimpleMeterRegistry());

    assertThatThrownBy(() -> guard.reserve(tenant, 10))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("budget metering is unavailable");
  }

  @Test
  void theProductionConstructorWiresTheDurableStore() {
    AiBudgetGuard guard = new AiBudgetGuard(100, sharedStore, new SimpleMeterRegistry());

    assertThat(guard.reserve(tenant, 10)).isTrue();
    assertThat(guard.remaining(tenant)).isEqualTo(90);
  }

  @Test
  void refundAndReconciliationFailuresDoNotFailTheRequest() {
    AiBudgetStore partiallyBroken =
        new AiBudgetStore() {
          @Override
          public ReservationResult reserve(
              String eventKey, UUID tenantId, LocalDate period, int tokens, long limit) {
            return sharedStore.reserve(eventKey, tenantId, period, tokens, limit);
          }

          @Override
          public long refund(String eventKey, UUID tenantId, LocalDate period, int tokens) {
            throw new IllegalStateException("refund ledger unavailable");
          }

          @Override
          public long reconcile(
              UUID tenantId, LocalDate period, int estimatedTokens, int actualTokens) {
            throw new IllegalStateException("reconcile ledger unavailable");
          }

          @Override
          public BudgetSnapshot snapshot(UUID tenantId, LocalDate period, long budgetTokens) {
            return sharedStore.snapshot(tenantId, period, budgetTokens);
          }

          @Override
          public void reset(UUID tenantId, LocalDate period) {}
        };
    AiBudgetGuard guard =
        new AiBudgetGuard(
            100, partiallyBroken, clock("2026-03-10T10:00:00Z"), new SimpleMeterRegistry());

    guard.refund(tenant, 10);
    guard.commit(tenant, 10, 5);

    assertThat(guard.used(tenant)).isZero();
  }

  @Test
  void snapshotReportsRemainingAndUtilization() {
    AiBudgetGuard guard = guard(100, sharedStore, clock("2026-03-10T10:00:00Z"));
    guard.reserve(tenant, 85);

    AiBudgetStore.BudgetSnapshot snapshot = guard.snapshot(tenant);

    assertThat(snapshot.usedTokens()).isEqualTo(85);
    assertThat(snapshot.remainingTokens()).isEqualTo(15);
    assertThat(snapshot.utilization()).isEqualTo(0.85);
    assertThat(snapshot.period()).isEqualTo(LocalDate.of(2026, 3, 1));
  }

  private static AiBudgetGuard guard(long budget, AiBudgetStore store, Clock clock) {
    return new AiBudgetGuard(budget, store, clock, new SimpleMeterRegistry());
  }

  private static Clock clock(String instant) {
    return Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
  }

  private static final class MutableClock extends Clock {

    private Instant instant;

    private MutableClock(Instant instant) {
      this.instant = instant;
    }

    void set(Instant next) {
      this.instant = next;
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

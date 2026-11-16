package com.awap.ai.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Durable monthly tenant AI token budget (issue #301).
 *
 * <p>The authoritative ledger lives in PostgreSQL ({@link JdbcAiBudgetStore}); reservations and
 * refunds are single atomic statements, so two replicas or a restart cannot reset or split a
 * tenant's budget. The budget window is the UTC calendar month; a new month starts a new ledger
 * row.
 *
 * <p>A storage failure is fail-closed: quota-enforcing calls receive {@code 503
 * USAGE_METERING_UNAVAILABLE} instead of being admitted without a budget.
 */
@Component
public class AiBudgetGuard {

  private static final Logger LOGGER = LoggerFactory.getLogger(AiBudgetGuard.class);
  public static final double NEAR_LIMIT_RATIO = 0.8d;

  private final long monthlyTokenBudget;
  private final AiBudgetStore store;
  private final Clock clock;
  private final MeterRegistry meterRegistry;

  @Autowired
  public AiBudgetGuard(
      @Value("${awap.ai.monthly-token-budget:200000}") long monthlyTokenBudget,
      AiBudgetStore store,
      MeterRegistry meterRegistry) {
    this(monthlyTokenBudget, store, Clock.systemUTC(), meterRegistry);
  }

  /** Test/support constructor with a deterministic clock and an in-memory ledger. */
  public AiBudgetGuard(long monthlyTokenBudget) {
    this(
        monthlyTokenBudget,
        new InMemoryBudgetStore(),
        Clock.systemUTC(),
        new SimpleMeterRegistry());
  }

  AiBudgetGuard(
      long monthlyTokenBudget, AiBudgetStore store, Clock clock, MeterRegistry meterRegistry) {
    this.monthlyTokenBudget = Math.max(1, monthlyTokenBudget);
    this.store = store;
    this.clock = clock;
    this.meterRegistry = meterRegistry;
  }

  /** Reserves tokens for the current UTC month; returns {@code false} when the budget is spent. */
  public boolean reserve(UUID tenantId, int tokens) {
    return reserve(tenantId, tokens, eventKey("ai-reserve", tenantId));
  }

  public boolean reserve(UUID tenantId, int tokens, String eventKey) {
    int requested = Math.max(1, tokens);
    AiBudgetStore.ReservationResult result;
    try {
      result = store.reserve(eventKey, tenantId, period(), requested, monthlyTokenBudget);
    } catch (RuntimeException ex) {
      meterRegistry.counter("awap.ai.budget.failures").increment();
      LOGGER.error("AI budget store is unavailable; rejecting the call (fail-closed).", ex);
      throw new AwapException(
          ErrorCode.USAGE_METERING_UNAVAILABLE,
          HttpStatus.SERVICE_UNAVAILABLE,
          "AI budget metering is unavailable; the request was rejected to protect the tenant cap.");
    }
    if (result.outcome() == AiBudgetStore.ReservationOutcome.EXCEEDED) {
      meterRegistry.counter("awap.ai.budget.utilization", "state", "exhausted").increment();
      return false;
    }
    if (result.outcome() == AiBudgetStore.ReservationOutcome.RESERVED) {
      alertIfNeeded(result.usedTokens());
    }
    return true;
  }

  /**
   * Reconciles the reserved estimate with the provider's actual usage, so the ledger converges on
   * the authoritative provider count rather than the client estimate.
   */
  public void commit(UUID tenantId, int estimatedTokens, int actualTokens) {
    try {
      long used = store.reconcile(tenantId, period(), estimatedTokens, actualTokens);
      meterRegistry.counter("awap.ai.budget.reconciled").increment();
      alertIfNeeded(used);
    } catch (RuntimeException ex) {
      // Reconciliation is observability-grade; it must not fail an otherwise successful model call.
      meterRegistry.counter("awap.ai.budget.reconcile_failures").increment();
      LOGGER.warn("AI budget reconciliation failed for tenant {}.", tenantId, ex);
    }
  }

  /**
   * Refunds a reservation after a provider failure (policy: failed calls do not consume budget).
   */
  public void refund(UUID tenantId, int tokens) {
    refund(tenantId, tokens, eventKey("ai-refund", tenantId));
  }

  public void refund(UUID tenantId, int tokens, String eventKey) {
    try {
      store.refund(eventKey, tenantId, period(), Math.max(1, tokens));
      meterRegistry.counter("awap.ai.budget.refunded").increment();
    } catch (RuntimeException ex) {
      meterRegistry.counter("awap.ai.budget.failures").increment();
      LOGGER.warn("AI budget refund failed for tenant {}.", tenantId, ex);
    }
  }

  /** Tokens consumed by the tenant in the current UTC month. */
  public long used(UUID tenantId) {
    return snapshot(tenantId).usedTokens();
  }

  public long remaining(UUID tenantId) {
    return snapshot(tenantId).remainingTokens();
  }

  public long budget() {
    return monthlyTokenBudget;
  }

  public AiBudgetStore.BudgetSnapshot snapshot(UUID tenantId) {
    return snapshot(tenantId, period());
  }

  public AiBudgetStore.BudgetSnapshot snapshot(UUID tenantId, LocalDate period) {
    return store.snapshot(tenantId, period, monthlyTokenBudget);
  }

  /** The first day of the current UTC month. */
  public LocalDate period() {
    return LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC).withDayOfMonth(1);
  }

  /** Test/support hook to reset a tenant's current budget window. */
  public void reset(UUID tenantId) {
    store.reset(tenantId, period());
  }

  private void alertIfNeeded(long usedTokens) {
    double ratio = (double) usedTokens / monthlyTokenBudget;
    if (usedTokens >= monthlyTokenBudget) {
      meterRegistry.counter("awap.ai.budget.utilization", "state", "exhausted").increment();
      LOGGER.warn(
          "Tenant AI budget exhausted: {} of {} tokens used in period {}.",
          usedTokens,
          monthlyTokenBudget,
          period());
    } else if (ratio >= NEAR_LIMIT_RATIO) {
      meterRegistry.counter("awap.ai.budget.utilization", "state", "near_limit").increment();
      LOGGER.warn(
          "Tenant AI budget at {}%: {} of {} tokens used in period {}.",
          Math.round(ratio * 100), usedTokens, monthlyTokenBudget, period());
    }
  }

  private static String eventKey(String prefix, UUID tenantId) {
    return prefix + ":" + tenantId + ":" + UUID.randomUUID();
  }

  /**
   * Test-only ledger with the same contract as the PostgreSQL adapter. It is deliberately not a
   * Spring bean: production always receives {@link JdbcAiBudgetStore}.
   */
  static final class InMemoryBudgetStore implements AiBudgetStore {

    private final Map<String, long[]> usage = new ConcurrentHashMap<>();
    private final Set<String> events = ConcurrentHashMap.newKeySet();

    @Override
    public synchronized ReservationResult reserve(
        String eventKey, UUID tenantId, LocalDate period, int tokens, long limit) {
      if (!events.add(eventKey)) {
        return new ReservationResult(ReservationOutcome.DUPLICATE, used(tenantId, period));
      }
      long[] row = usage.computeIfAbsent(key(tenantId, period), ignored -> new long[2]);
      if (row[0] + tokens > limit) {
        events.remove(eventKey);
        return new ReservationResult(ReservationOutcome.EXCEEDED, row[0]);
      }
      row[0] += tokens;
      row[1] += tokens;
      return new ReservationResult(ReservationOutcome.RESERVED, row[0]);
    }

    @Override
    public synchronized long refund(String eventKey, UUID tenantId, LocalDate period, int tokens) {
      if (!events.add(eventKey)) {
        return used(tenantId, period);
      }
      long[] row = usage.computeIfAbsent(key(tenantId, period), ignored -> new long[2]);
      row[0] = Math.max(0, row[0] - tokens);
      row[1] = Math.max(0, row[1] - tokens);
      return row[0];
    }

    @Override
    public synchronized long reconcile(
        UUID tenantId, LocalDate period, int estimatedTokens, int actualTokens) {
      long[] row = usage.computeIfAbsent(key(tenantId, period), ignored -> new long[2]);
      long delta = (long) actualTokens - estimatedTokens;
      row[0] = Math.max(0, row[0] + delta);
      row[1] = Math.max(0, row[1] + delta);
      return row[0];
    }

    @Override
    public synchronized BudgetSnapshot snapshot(
        UUID tenantId, LocalDate period, long budgetTokens) {
      long[] row = usage.getOrDefault(key(tenantId, period), new long[2]);
      return new BudgetSnapshot(tenantId, period, row[0], row[1], budgetTokens);
    }

    @Override
    public synchronized void reset(UUID tenantId, LocalDate period) {
      usage.remove(key(tenantId, period));
      events.removeIf(key -> key.startsWith("ai-") && key.contains(tenantId.toString()));
    }

    private long used(UUID tenantId, LocalDate period) {
      long[] row = usage.getOrDefault(key(tenantId, period), new long[2]);
      return row[0];
    }

    private static String key(UUID tenantId, LocalDate period) {
      return tenantId + ":" + period;
    }
  }
}

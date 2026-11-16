package com.awap.ai.application;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Outbound port for the durable monthly AI budget ledger (issue #301).
 *
 * <p>The production adapter executes atomic PostgreSQL functions, so concurrent replicas serialize
 * on one row and a restart cannot reset the tenant's usage. Tests use an in-memory adapter with the
 * same observable contract.
 */
public interface AiBudgetStore {

  ReservationResult reserve(
      String eventKey, UUID tenantId, LocalDate period, int tokens, long limit);

  long refund(String eventKey, UUID tenantId, LocalDate period, int tokens);

  long reconcile(UUID tenantId, LocalDate period, int estimatedTokens, int actualTokens);

  BudgetSnapshot snapshot(UUID tenantId, LocalDate period, long budgetTokens);

  /** Test/support hook: clears the period for a tenant. */
  void reset(UUID tenantId, LocalDate period);

  enum ReservationOutcome {
    RESERVED,
    DUPLICATE,
    EXCEEDED
  }

  record ReservationResult(ReservationOutcome outcome, long usedTokens) {}

  record BudgetSnapshot(
      UUID tenantId, LocalDate period, long usedTokens, long reservedTokens, long budgetTokens) {

    public long remainingTokens() {
      return Math.max(0, budgetTokens - usedTokens);
    }

    public double utilization() {
      return budgetTokens <= 0 ? 0.0 : Math.min(1.0, (double) usedTokens / budgetTokens);
    }
  }
}

package com.awap.ai.infrastructure;

import com.awap.ai.application.AiBudgetStore;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * PostgreSQL adapter for {@link AiBudgetStore}. Every mutation is one database function call, so
 * two replicas sharing the same database cannot over-admit the monthly budget and a restart
 * preserves usage (issue #301).
 */
@Component
public class JdbcAiBudgetStore implements AiBudgetStore {

  private static final long DUPLICATE = -2L;
  private static final long EXCEEDED = -1L;

  private final JdbcTemplate jdbcTemplate;

  public JdbcAiBudgetStore(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Override
  public ReservationResult reserve(
      String eventKey, UUID tenantId, LocalDate period, int tokens, long limit) {
    Long result =
        jdbcTemplate.queryForObject(
            "SELECT awap_ai_budget_reserve(?, ?, ?, ?, ?)",
            Long.class,
            eventKey,
            tenantId,
            period,
            Math.max(1, tokens),
            limit);
    long value = result == null ? EXCEEDED : result;
    if (value == DUPLICATE) {
      return new AiBudgetStore.ReservationResult(
          AiBudgetStore.ReservationOutcome.DUPLICATE, used(tenantId, period));
    }
    if (value == EXCEEDED) {
      return new AiBudgetStore.ReservationResult(
          AiBudgetStore.ReservationOutcome.EXCEEDED, used(tenantId, period));
    }
    return new AiBudgetStore.ReservationResult(AiBudgetStore.ReservationOutcome.RESERVED, value);
  }

  @Override
  public long refund(String eventKey, UUID tenantId, LocalDate period, int tokens) {
    Long result =
        jdbcTemplate.queryForObject(
            "SELECT awap_ai_budget_refund(?, ?, ?, ?)",
            Long.class,
            eventKey,
            tenantId,
            period,
            Math.max(1, tokens));
    return result == null ? 0 : result;
  }

  @Override
  public long reconcile(UUID tenantId, LocalDate period, int estimatedTokens, int actualTokens) {
    Long result =
        jdbcTemplate.queryForObject(
            "SELECT awap_ai_budget_reconcile(?, ?, ?, ?)",
            Long.class,
            tenantId,
            period,
            Math.max(0, estimatedTokens),
            Math.max(0, actualTokens));
    return result == null ? 0 : result;
  }

  @Override
  public BudgetSnapshot snapshot(UUID tenantId, LocalDate period, long budgetTokens) {
    List<AiBudgetStore.BudgetSnapshot> rows =
        jdbcTemplate.query(
            "SELECT used_tokens, reserved_tokens FROM ai_budget_usage "
                + "WHERE tenant_id = ? AND period = ?",
            (rs, index) ->
                new AiBudgetStore.BudgetSnapshot(
                    tenantId,
                    period,
                    rs.getLong("used_tokens"),
                    rs.getLong("reserved_tokens"),
                    budgetTokens),
            tenantId,
            period);
    return rows.isEmpty()
        ? new AiBudgetStore.BudgetSnapshot(tenantId, period, 0, 0, budgetTokens)
        : rows.get(0);
  }

  @Override
  public void reset(UUID tenantId, LocalDate period) {
    jdbcTemplate.update(
        "DELETE FROM ai_budget_events WHERE tenant_id = ? AND period = ?", tenantId, period);
    jdbcTemplate.update(
        "DELETE FROM ai_budget_usage WHERE tenant_id = ? AND period = ?", tenantId, period);
  }

  private long used(UUID tenantId, LocalDate period) {
    Long used =
        jdbcTemplate.queryForObject(
            "SELECT COALESCE(MAX(used_tokens), 0) FROM ai_budget_usage "
                + "WHERE tenant_id = ? AND period = ?",
            Long.class,
            tenantId,
            period);
    return used == null ? 0 : used;
  }
}

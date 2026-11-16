package com.awap.ai.interfaces.api;

import com.awap.ai.application.AiBudgetGuard;
import com.awap.ai.application.AiBudgetStore;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.infrastructure.security.TenantContext;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Tenant-facing visibility into the durable monthly AI budget (issue #301).
 *
 * <p>The caller only ever sees their own tenant; the tenant transaction aspect enforces RLS on the
 * underlying ledger. Warning states mirror the alerting thresholds (80% near limit, 100%
 * exhausted).
 */
@RestController
@RequestMapping("/api/v1/ai/budget")
public class AiBudgetController {

  private final AiBudgetGuard budgetGuard;

  public AiBudgetController(AiBudgetGuard budgetGuard) {
    this.budgetGuard = budgetGuard;
  }

  @GetMapping
  public BudgetResponse current() {
    UUID tenantId =
        TenantContext.current()
            .map(TenantContext.Context::tenantId)
            .orElseThrow(
                () ->
                    new AwapException(
                        ErrorCode.UNAUTHORIZED,
                        HttpStatus.UNAUTHORIZED,
                        "Authentication is required."));
    AiBudgetStore.BudgetSnapshot snapshot = budgetGuard.snapshot(tenantId);
    return new BudgetResponse(
        snapshot.tenantId(),
        snapshot.period(),
        snapshot.budgetTokens(),
        snapshot.usedTokens(),
        snapshot.reservedTokens(),
        snapshot.remainingTokens(),
        snapshot.utilization(),
        warning(snapshot));
  }

  private static String warning(AiBudgetStore.BudgetSnapshot snapshot) {
    if (snapshot.usedTokens() >= snapshot.budgetTokens()) {
      return "EXHAUSTED";
    }
    if (snapshot.utilization() >= AiBudgetGuard.NEAR_LIMIT_RATIO) {
      return "NEAR_LIMIT";
    }
    return "OK";
  }

  /** Stable response for operators and the admin UI. */
  public record BudgetResponse(
      UUID tenantId,
      LocalDate period,
      long budgetTokens,
      long usedTokens,
      long reservedTokens,
      long remainingTokens,
      double utilization,
      String warning) {}
}

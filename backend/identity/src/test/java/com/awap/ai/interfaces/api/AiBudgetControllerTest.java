package com.awap.ai.interfaces.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.awap.ai.application.AiBudgetGuard;
import com.awap.identity.infrastructure.security.TenantContext;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class AiBudgetControllerTest {

  private final UUID tenant = UUID.randomUUID();
  private final AiBudgetGuard guard = new AiBudgetGuard(100);
  private final AiBudgetController controller = new AiBudgetController(guard);

  @AfterEach
  void clearContext() {
    TenantContext.clear();
  }

  @Test
  void reportsRemainingBudgetAndNearLimitWarning() {
    TenantContext.set(tenant, UUID.randomUUID(), "TENANT_ADMIN");
    guard.reserve(tenant, 85);

    AiBudgetController.BudgetResponse response = controller.current();

    assertThat(response.tenantId()).isEqualTo(tenant);
    assertThat(response.budgetTokens()).isEqualTo(100);
    assertThat(response.usedTokens()).isEqualTo(85);
    assertThat(response.remainingTokens()).isEqualTo(15);
    assertThat(response.utilization()).isEqualTo(0.85);
    assertThat(response.warning()).isEqualTo("NEAR_LIMIT");
  }

  @Test
  void reportsExhaustedWhenTheBudgetIsSpent() {
    TenantContext.set(tenant, UUID.randomUUID(), "TENANT_ADMIN");
    guard.reserve(tenant, 100);

    assertThat(controller.current().warning()).isEqualTo("EXHAUSTED");
  }

  @Test
  void reportsOkBelowTheWarningThreshold() {
    TenantContext.set(tenant, UUID.randomUUID(), "TENANT_ADMIN");

    assertThat(controller.current().warning()).isEqualTo("OK");
  }

  @Test
  void rejectsAnUnauthenticatedCaller() {
    org.assertj.core.api.Assertions.assertThatThrownBy(controller::current)
        .isInstanceOf(com.awap.common.api.AwapException.class)
        .hasMessageContaining("Authentication is required");
  }
}

package com.awap.identity.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Verifies identity domain invariants: account lockout, tenant limits and role permissions. */
class IdentityDomainTest {

  @Test
  void accountLocksAfterFiveFailedAttempts() {
    User user = new User(UUID.randomUUID(), "a@b.c", "hash", "A", Role.EMPLOYEE);

    for (int i = 0; i < 5; i++) {
      user.registerFailedLogin();
    }

    assertThat(user.isLocked()).isTrue();
  }

  @Test
  void resetFailedLoginClearsLock() {
    User user = new User(UUID.randomUUID(), "a@b.c", "hash", "A", Role.EMPLOYEE);
    for (int i = 0; i < 5; i++) {
      user.registerFailedLogin();
    }

    user.resetFailedLogin();

    assertThat(user.isLocked()).isFalse();
  }

  @Test
  void assignRoleUpdatesRole() {
    User user = new User(UUID.randomUUID(), "a@b.c", "hash", "A", Role.EMPLOYEE);

    user.assignRole(Role.TENANT_ADMIN);

    assertThat(user.getRole()).isEqualTo(Role.TENANT_ADMIN);
  }

  @Test
  void markDeletedSoftDeletesTheAccountAndKeepsItsCreationTime() {
    User user = new User(UUID.randomUUID(), "a@b.c", "hash", "A", Role.EMPLOYEE);

    assertThat(user.getCreatedAt()).isNotNull();
    user.markDeleted();

    assertThat(user.isDeleted()).isTrue();
  }

  @Test
  void invitationExposesItsCreationTime() {
    Invitation invitation =
        new Invitation(
            UUID.randomUUID(),
            "a@b.c",
            Role.EMPLOYEE,
            "hash",
            Instant.now().plus(Duration.ofDays(1)),
            UUID.randomUUID());

    assertThat(invitation.getCreatedAt()).isNotNull();
  }

  @Test
  void tenantUpdateLimitsChangesQuotas() {
    Tenant tenant = new Tenant("acme", "Acme", "FREE", 5, 2, 100);

    tenant.updateLimits("ENTERPRISE", 50, 20, 10_000);

    assertThat(tenant.getPlan()).isEqualTo("ENTERPRISE");
    assertThat(tenant.getMaxUsers()).isEqualTo(50);
    assertThat(tenant.getMaxWorkflows()).isEqualTo(20);
    assertThat(tenant.getMaxAiCallsPerMonth()).isEqualTo(10_000);
  }

  @Test
  void rolePermissionsAreGrantedAsExpected() {
    assertThat(Role.SYSTEM_ADMIN.hasPermission(Permission.TENANT_MANAGE)).isTrue();
    assertThat(Role.TENANT_ADMIN.hasPermission(Permission.USER_MANAGE)).isTrue();
    assertThat(Role.EMPLOYEE.hasPermission(Permission.TENANT_MANAGE)).isFalse();
    assertThat(Role.MANAGER.hasPermission(Permission.TASK_APPROVE)).isTrue();
  }
}

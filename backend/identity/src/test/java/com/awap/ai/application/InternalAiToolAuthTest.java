package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.identity.domain.Permission;
import com.awap.identity.domain.Role;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.identity.infrastructure.security.TenantTransactionRunner;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

class InternalAiToolAuthTest {

  private final UUID tenantId = UUID.randomUUID();
  private final UUID userId = UUID.randomUUID();
  private final InternalAiToolAuth auth =
      new InternalAiToolAuth("service-secret", mock(TenantTransactionRunner.class));

  @Test
  void rejectsWhenTheServiceTokenIsMissingOrWrong() {
    HttpServletRequest request = request("wrong", "TENANT_ADMIN");

    assertThatThrownBy(() -> auth.authenticate(request, Permission.INSTANCE_READ))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(401));
  }

  @Test
  void rejectsARoleWithoutTheRequiredPermission() {
    HttpServletRequest request = request("service-secret", "EMPLOYEE");

    assertThatThrownBy(() -> auth.authenticate(request, Permission.INSTANCE_MANAGE))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(403));
  }

  @Test
  void returnsTheCallerWhenCredentialAndRoleAreValid() {
    HttpServletRequest request = request("service-secret", "TENANT_ADMIN");

    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.INSTANCE_MANAGE);

    assertThat(caller.tenantId()).isEqualTo(tenantId);
    assertThat(caller.userId()).isEqualTo(userId);
    assertThat(caller.role()).isEqualTo(Role.TENANT_ADMIN);
    assertThat(caller.optionalUserId()).contains(userId);
  }

  @Test
  void rejectsEveryCallWhenTheServiceTokenIsNotConfigured() {
    InternalAiToolAuth unconfigured =
        new InternalAiToolAuth(" ", mock(TenantTransactionRunner.class));

    assertThatThrownBy(() -> unconfigured.authenticate(request("anything", "TENANT_ADMIN"), null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("not configured");
  }

  @Test
  void rejectsAMissingServiceToken() {
    assertThatThrownBy(() -> auth.authenticate(request(null, "TENANT_ADMIN"), null))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(401));
  }

  @Test
  void rejectsAnUnknownRole() {
    assertThatThrownBy(() -> auth.authenticate(request("service-secret", "GHOST"), null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Unknown caller role");
  }

  @Test
  void rejectsAMissingOrMalformedTenantHeader() {
    HttpServletRequest missingTenant = request("service-secret", "TENANT_ADMIN");
    when(missingTenant.getHeader("X-Tenant-Id")).thenReturn("");
    HttpServletRequest malformedTenant = request("service-secret", "TENANT_ADMIN");
    when(malformedTenant.getHeader("X-Tenant-Id")).thenReturn("not-a-uuid");

    assertThatThrownBy(() -> auth.authenticate(missingTenant, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Missing X-Tenant-Id header");
    assertThatThrownBy(() -> auth.authenticate(malformedTenant, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Invalid X-Tenant-Id header");
  }

  @Test
  void inTenantRunsTheActionAndClearsTheContextAfterwards() {
    TenantTransactionRunner runner = mock(TenantTransactionRunner.class);
    when(runner.call(org.mockito.ArgumentMatchers.any()))
        .thenAnswer(invocation -> ((Supplier<?>) invocation.getArgument(0)).get());
    InternalAiToolAuth scoped = new InternalAiToolAuth("service-secret", runner);
    InternalAiToolAuth.Caller caller =
        new InternalAiToolAuth.Caller(tenantId, userId, Role.EMPLOYEE);

    String result = scoped.inTenant(caller, () -> TenantContext.requireTenantId().toString());

    assertThat(result).isEqualTo(tenantId.toString());
    assertThat(TenantContext.current()).isEmpty();
  }

  private HttpServletRequest request(String token, String role) {
    HttpServletRequest request = mock(HttpServletRequest.class);
    when(request.getHeader("X-Ai-Service-Token")).thenReturn(token);
    when(request.getHeader("X-Tenant-Id")).thenReturn(tenantId.toString());
    when(request.getHeader("X-User-Id")).thenReturn(userId.toString());
    when(request.getHeader("X-User-Role")).thenReturn(role);
    return request;
  }
}

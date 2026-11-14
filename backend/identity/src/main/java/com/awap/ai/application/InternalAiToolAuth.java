package com.awap.ai.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.domain.Permission;
import com.awap.identity.domain.Role;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.identity.infrastructure.security.TenantTransactionRunner;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Authentication and authorization for the AI layer's internal tool calls.
 *
 * <p>The AI service presents a shared service credential plus the authenticated user's tenant, user
 * and role. The role is re-verified here on every call; the caller cannot grant itself authority by
 * sending a permission list. A tool that needs a permission the role does not hold is rejected with
 * 403 before any domain service is invoked.
 */
@Component
public class InternalAiToolAuth {

  private final String serviceToken;
  private final TenantTransactionRunner transactionRunner;

  public InternalAiToolAuth(
      @Value("${awap.ai.internal-token:}") String serviceToken,
      TenantTransactionRunner transactionRunner) {
    this.serviceToken = serviceToken;
    this.transactionRunner = transactionRunner;
  }

  public Caller authenticate(HttpServletRequest request, Permission required) {
    if (serviceToken == null || serviceToken.isBlank()) {
      throw unauthorized("AI internal tool authentication is not configured.");
    }
    String provided = request.getHeader("X-Ai-Service-Token");
    if (!constantTimeEquals(serviceToken, provided)) {
      throw unauthorized("Invalid AI service token.");
    }
    UUID tenantId = uuidHeader(request, "X-Tenant-Id");
    UUID userId = uuidHeader(request, "X-User-Id");
    String roleValue = request.getHeader("X-User-Role");
    Role role;
    try {
      role = Role.valueOf(roleValue == null ? "" : roleValue.trim().toUpperCase());
    } catch (IllegalArgumentException ex) {
      throw new AwapException(
          ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, "Unknown caller role for the AI tool call.");
    }
    if (required != null && !role.hasPermission(required)) {
      throw new AwapException(
          ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, "The AI tool call requires " + required + ".");
    }
    return new Caller(tenantId, userId, role);
  }

  /** Runs the tool inside a transaction after establishing the tenant context (RLS). */
  public <T> T inTenant(Caller caller, Supplier<T> action) {
    TenantContext.set(caller.tenantId(), caller.userId(), caller.role().name());
    try {
      return transactionRunner.call(action);
    } finally {
      TenantContext.clear();
    }
  }

  private static UUID uuidHeader(HttpServletRequest request, String name) {
    String value = request.getHeader(name);
    if (value == null || value.isBlank()) {
      throw unauthorized("Missing " + name + " header.");
    }
    try {
      return UUID.fromString(value.trim());
    } catch (IllegalArgumentException ex) {
      throw unauthorized("Invalid " + name + " header.");
    }
  }

  private static boolean constantTimeEquals(String expected, String actual) {
    if (actual == null) {
      return false;
    }
    return MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
  }

  private static AwapException unauthorized(String detail) {
    return new AwapException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, detail);
  }

  public record Caller(UUID tenantId, UUID userId, Role role) {
    public Optional<UUID> optionalUserId() {
      return Optional.of(userId);
    }
  }
}

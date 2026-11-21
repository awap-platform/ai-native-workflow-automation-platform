package com.awap.identity.interfaces.api;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.application.AdminConsoleService;
import com.awap.identity.application.BreakGlassLogService;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.identity.interfaces.dto.AdminAuditPageResponse;
import com.awap.identity.interfaces.dto.AdminDlqDelivery;
import com.awap.identity.interfaces.dto.AdminDlqRetryResponse;
import com.awap.identity.interfaces.dto.AdminIdentityResponse;
import com.awap.identity.interfaces.dto.AdminInvitationCreated;
import com.awap.identity.interfaces.dto.AdminInvitationRequest;
import com.awap.identity.interfaces.dto.AdminOperateResponse;
import com.awap.identity.interfaces.dto.AdminUserRoleRequest;
import com.awap.identity.interfaces.dto.BreakGlassLogResponse;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Phase 8 admin and identity console endpoints.
 *
 * <p>Every endpoint requires {@code USER_MANAGE}. The service additionally requires an admin role
 * and verifies that a requested tenant matches the caller's tenant unless the caller is a system
 * administrator. Privileged mutations are audited by the service.
 */
@RestController
@PreAuthorize("hasAuthority('USER_MANAGE')")
@RequestMapping("/api/v1/admin")
public class AdminConsoleController {

  private final AdminConsoleService adminConsoleService;
  private final BreakGlassLogService breakGlassLogService;

  public AdminConsoleController(
      AdminConsoleService adminConsoleService, BreakGlassLogService breakGlassLogService) {
    this.adminConsoleService = adminConsoleService;
    this.breakGlassLogService = breakGlassLogService;
  }

  @GetMapping("/identity")
  public ResponseEntity<AdminIdentityResponse> identity(
      @RequestParam(name = "tenantId", required = false) UUID tenantId) {
    TenantContext.Context context = context();
    return ResponseEntity.ok(
        adminConsoleService.identity(
            tenantOrDefault(tenantId, context), context.tenantId(), context.role()));
  }

  @GetMapping("/operate")
  public ResponseEntity<AdminOperateResponse> operate(
      @RequestParam(name = "tenantId", required = false) UUID tenantId) {
    TenantContext.Context context = context();
    return ResponseEntity.ok(
        adminConsoleService.operate(
            tenantOrDefault(tenantId, context), context.tenantId(), context.role()));
  }

  @GetMapping("/audit")
  public ResponseEntity<AdminAuditPageResponse> audit(
      @RequestParam(name = "tenantId", required = false) UUID tenantId,
      @RequestParam(name = "cursor", required = false) String cursor,
      @RequestParam(name = "limit", defaultValue = "25") int limit) {
    TenantContext.Context context = context();
    return ResponseEntity.ok(
        adminConsoleService.audit(
            tenantOrDefault(tenantId, context), context.tenantId(), context.role(), cursor, limit));
  }

  @GetMapping("/audit/export")
  public ResponseEntity<byte[]> exportAudit(
      @RequestParam(name = "tenantId", required = false) UUID tenantId,
      @RequestParam(name = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate from,
      @RequestParam(name = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate to) {
    TenantContext.Context context = context();
    AdminConsoleService.AuditExport export =
        adminConsoleService.exportAudit(
            tenantOrDefault(tenantId, context), context.tenantId(), context.role(), from, to);
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"awap-audit.csv\"")
        .header("X-AWAP-Export-Truncated", Boolean.toString(export.truncated()))
        .body(export.body());
  }

  @PutMapping("/users/{userId}/role")
  public ResponseEntity<AdminIdentityResponse.AdminUser> changeRole(
      @PathVariable UUID userId,
      @RequestParam(name = "tenantId", required = false) UUID tenantId,
      @Valid @RequestBody AdminUserRoleRequest request) {
    TenantContext.Context context = context();
    return ResponseEntity.ok(
        adminConsoleService.changeRole(
            tenantOrDefault(tenantId, context),
            context.tenantId(),
            context.role(),
            context.userId(),
            userId,
            request.role()));
  }

  @DeleteMapping("/users/{userId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteUser(
      @PathVariable UUID userId, @RequestParam(name = "tenantId", required = false) UUID tenantId) {
    TenantContext.Context context = context();
    adminConsoleService.deleteUser(
        tenantOrDefault(tenantId, context),
        context.tenantId(),
        context.role(),
        context.userId(),
        userId);
  }

  @PostMapping("/invitations")
  public ResponseEntity<AdminInvitationCreated> invite(
      @RequestParam(name = "tenantId", required = false) UUID tenantId,
      @Valid @RequestBody AdminInvitationRequest request) {
    TenantContext.Context context = context();
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            adminConsoleService.invite(
                tenantOrDefault(tenantId, context),
                context.tenantId(),
                context.role(),
                context.userId(),
                request.email(),
                request.role()));
  }

  @GetMapping("/dlq")
  public ResponseEntity<List<AdminDlqDelivery>> dlq(
      @RequestParam(name = "tenantId", required = false) UUID tenantId) {
    TenantContext.Context context = context();
    return ResponseEntity.ok(
        adminConsoleService.dlq(
            tenantOrDefault(tenantId, context), context.tenantId(), context.role()));
  }

  @PostMapping("/dlq/{deliveryId}/retry")
  public ResponseEntity<AdminDlqRetryResponse> retryDlq(
      @PathVariable UUID deliveryId,
      @RequestParam(name = "tenantId", required = false) UUID tenantId) {
    TenantContext.Context context = context();
    return ResponseEntity.ok(
        adminConsoleService.retryDlq(
            tenantOrDefault(tenantId, context),
            context.tenantId(),
            context.role(),
            context.userId(),
            deliveryId));
  }

  @GetMapping("/break-glass")
  public ResponseEntity<BreakGlassLogResponse> breakGlass() {
    return ResponseEntity.ok(breakGlassLogService.read());
  }

  private static UUID tenantOrDefault(UUID requested, TenantContext.Context context) {
    return requested == null ? context.tenantId() : requested;
  }

  private static TenantContext.Context context() {
    return TenantContext.current()
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.UNAUTHORIZED,
                    HttpStatus.UNAUTHORIZED,
                    "Authentication is required."));
  }
}

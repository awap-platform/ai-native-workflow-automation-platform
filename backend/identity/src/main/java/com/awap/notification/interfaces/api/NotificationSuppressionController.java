package com.awap.notification.interfaces.api;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.notification.application.NotificationSuppressionService;
import com.awap.notification.domain.NotificationSuppression;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Tenant-scoped, read-only suppression list used by the delivery-operations panel.
 *
 * <p>A suppressed recipient is never contacted again on that channel, so support needs to see the
 * channel, recipient, reason and timestamp without reaching into the database.
 */
@RestController
@RequestMapping("/api/v1/notifications/suppressions")
public class NotificationSuppressionController {

  private final NotificationSuppressionService suppressionService;

  public NotificationSuppressionController(NotificationSuppressionService suppressionService) {
    this.suppressionService = suppressionService;
  }

  @GetMapping
  @PreAuthorize("hasAuthority('INSTANCE_READ')")
  public ResponseEntity<List<SuppressionResponse>> list() {
    UUID tenantId =
        TenantContext.current()
            .map(TenantContext.Context::tenantId)
            .orElseThrow(
                () ->
                    new AwapException(
                        ErrorCode.UNAUTHORIZED,
                        HttpStatus.UNAUTHORIZED,
                        "Authentication is required."));
    return ResponseEntity.ok(
        suppressionService.list(tenantId).stream()
            .map(NotificationSuppressionController::toResponse)
            .toList());
  }

  static SuppressionResponse toResponse(NotificationSuppression suppression) {
    return new SuppressionResponse(
        suppression.getId(),
        suppression.getChannel().name(),
        suppression.getRecipient(),
        suppression.getReason(),
        suppression.getCreatedAt());
  }

  /** Public representation of a blocked recipient. */
  public record SuppressionResponse(
      UUID id, String channel, String recipient, String reason, Instant createdAt) {}
}

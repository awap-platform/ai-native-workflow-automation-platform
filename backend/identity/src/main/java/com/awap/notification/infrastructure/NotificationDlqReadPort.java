package com.awap.notification.infrastructure;

import com.awap.identity.application.DlqReadPort;
import com.awap.notification.domain.NotificationDelivery;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Notification-backed implementation of the identity admin console's DLQ port. */
@Component
public class NotificationDlqReadPort implements DlqReadPort {

  private final NotificationDeliveryRepository repository;

  public NotificationDlqReadPort(NotificationDeliveryRepository repository) {
    this.repository = repository;
  }

  @Override
  public List<DlqRecord> listFailed(UUID tenantId) {
    return repository
        .findByTenantIdAndStatusOrderByCreatedAtDesc(tenantId, NotificationDelivery.FAILED)
        .stream()
        .map(
            delivery ->
                new DlqRecord(
                    delivery.getId(),
                    delivery.getChannel().name(),
                    delivery.getRecipient(),
                    delivery.getTemplateKey(),
                    delivery.getAttempts(),
                    delivery.getLastError(),
                    delivery.getCreatedAt()))
        .toList();
  }

  @Override
  public long countFailed(UUID tenantId) {
    return repository.countByTenantIdAndStatus(tenantId, NotificationDelivery.FAILED);
  }

  @Override
  public long countRetrying(UUID tenantId) {
    return repository.countByTenantIdAndStatus(tenantId, NotificationDelivery.RETRYING);
  }

  @Override
  public int requeue(UUID tenantId, UUID deliveryId, Instant now) {
    return repository.requeueFailed(deliveryId, tenantId, now);
  }
}

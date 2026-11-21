package com.awap.notification.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.notification.domain.NotificationChannel;
import com.awap.notification.domain.NotificationDelivery;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class NotificationDlqReadPortTest {

  private NotificationDeliveryRepository repository;
  private NotificationDlqReadPort port;
  private final UUID tenantId = UUID.randomUUID();

  @BeforeEach
  void setUp() {
    repository = mock(NotificationDeliveryRepository.class);
    port = new NotificationDlqReadPort(repository);
  }

  @Test
  void mapsFailedDeliveriesToTheConsoleShape() {
    NotificationDelivery delivery = mock(NotificationDelivery.class);
    when(delivery.getId()).thenReturn(UUID.randomUUID());
    when(delivery.getChannel()).thenReturn(NotificationChannel.EMAIL);
    when(delivery.getRecipient()).thenReturn("ada@acme.test");
    when(delivery.getTemplateKey()).thenReturn("task.assigned");
    when(delivery.getAttempts()).thenReturn(3);
    when(delivery.getLastError()).thenReturn("smtp timeout");
    when(delivery.getCreatedAt()).thenReturn(Instant.parse("2026-11-09T10:00:00Z"));
    when(repository.findByTenantIdAndStatusOrderByCreatedAtDesc(
            tenantId, NotificationDelivery.FAILED))
        .thenReturn(List.of(delivery));

    var rows = port.listFailed(tenantId);

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).channel()).isEqualTo("EMAIL");
    assertThat(rows.get(0).recipient()).isEqualTo("ada@acme.test");
    assertThat(rows.get(0).attempts()).isEqualTo(3);
  }

  @Test
  void countsFailedAndRetryingDeliveries() {
    when(repository.countByTenantIdAndStatus(tenantId, NotificationDelivery.FAILED)).thenReturn(2L);
    when(repository.countByTenantIdAndStatus(tenantId, NotificationDelivery.RETRYING))
        .thenReturn(4L);

    assertThat(port.countFailed(tenantId)).isEqualTo(2);
    assertThat(port.countRetrying(tenantId)).isEqualTo(4);
  }

  @Test
  void reQueuesThroughTheConditionalRepositoryUpdate() {
    UUID deliveryId = UUID.randomUUID();
    Instant now = Instant.parse("2026-11-09T10:00:00Z");
    when(repository.requeueFailed(deliveryId, tenantId, now)).thenReturn(1);

    assertThat(port.requeue(tenantId, deliveryId, now)).isEqualTo(1);
    verify(repository).requeueFailed(deliveryId, tenantId, now);
  }
}

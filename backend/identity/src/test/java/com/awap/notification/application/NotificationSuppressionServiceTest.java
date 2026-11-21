package com.awap.notification.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.notification.domain.NotificationChannel;
import com.awap.notification.domain.NotificationSuppression;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class NotificationSuppressionServiceTest {

  private static final UUID TENANT = UUID.randomUUID();

  private final NotificationSuppressionStore store =
      Mockito.mock(NotificationSuppressionStore.class);
  private final NotificationSuppressionService service = new NotificationSuppressionService(store);

  @Test
  void listsTheTenantSuppressionReasonForOperations() {
    NotificationSuppression suppression =
        new NotificationSuppression(
            TENANT, NotificationChannel.EMAIL, "ada@example.com", "SMTP_BOUNCE");
    when(store.list(TENANT)).thenReturn(List.of(suppression));

    assertThat(service.list(TENANT)).containsExactly(suppression);
    verify(store).list(TENANT);
  }
}

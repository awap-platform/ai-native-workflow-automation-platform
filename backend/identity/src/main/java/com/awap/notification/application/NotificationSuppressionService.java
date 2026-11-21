package com.awap.notification.application;

import com.awap.notification.domain.NotificationSuppression;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only delivery-operations view of the bounce/complaint suppression list.
 *
 * <p>The dispatcher still writes suppressions through {@link NotificationSuppressionStore}; this
 * service exists so the support surface can explain why a recipient is no longer contacted without
 * exposing the store port to the web layer.
 */
@Service
public class NotificationSuppressionService {

  private final NotificationSuppressionStore store;

  public NotificationSuppressionService(NotificationSuppressionStore store) {
    this.store = store;
  }

  /** Lists every blocked recipient of one tenant, newest first. */
  @Transactional(readOnly = true)
  public List<NotificationSuppression> list(UUID tenantId) {
    return store.list(tenantId);
  }
}

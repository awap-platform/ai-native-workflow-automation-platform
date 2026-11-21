package com.awap.identity.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Port for the operator dead-letter projection.
 *
 * <p>The identity admin console must not depend on the notification module's infrastructure. The
 * notification module implements this port, so the dependency stays notification → identity (the
 * direction that already exists) and the module cycle does not grow.
 */
public interface DlqReadPort {

  /** One terminally failed delivery in a shape the admin console can render. */
  record DlqRecord(
      UUID id,
      String channel,
      String recipient,
      String templateKey,
      int attempts,
      String lastError,
      Instant createdAt) {}

  /** All terminally failed deliveries for the tenant. */
  List<DlqRecord> listFailed(UUID tenantId);

  /** Number of terminally failed deliveries for the tenant. */
  long countFailed(UUID tenantId);

  /** Number of deliveries currently scheduled for a retry. */
  long countRetrying(UUID tenantId);

  /** Conditionally re-queues one failed delivery; returns 1 when it moved. */
  int requeue(UUID tenantId, UUID deliveryId, Instant now);
}

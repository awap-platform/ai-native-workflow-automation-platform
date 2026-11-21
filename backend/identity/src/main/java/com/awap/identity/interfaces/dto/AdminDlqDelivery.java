package com.awap.identity.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One terminally failed notification delivery exposed as the operator dead-letter view.
 *
 * <p>The platform's Kafka DLQ consumer quarantines malformed records to a file and deliberately
 * never re-publishes them. The retryable dead-letter projection is therefore the persisted
 * terminal-failure notification queue, which has a real retry path.
 */
public record AdminDlqDelivery(
    UUID id,
    String channel,
    String recipient,
    String templateKey,
    int attempts,
    String lastError,
    Instant createdAt) {}

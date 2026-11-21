package com.awap.identity.interfaces.dto;

import java.util.UUID;

/** Result of re-queueing one dead-letter delivery. */
public record AdminDlqRetryResponse(UUID id, String status, int attempts, String detail) {}

package com.awap.identity.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/** Invitation creation result; the raw token is returned exactly once. */
public record AdminInvitationCreated(
    UUID id, String email, String role, Instant expiresAt, String token) {}

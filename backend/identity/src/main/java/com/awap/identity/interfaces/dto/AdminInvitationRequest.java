package com.awap.identity.interfaces.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** Invitation creation requested by the admin console. */
public record AdminInvitationRequest(@NotBlank @Email String email, @NotBlank String role) {}

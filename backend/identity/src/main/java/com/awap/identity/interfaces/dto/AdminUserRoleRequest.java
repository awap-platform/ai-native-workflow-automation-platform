package com.awap.identity.interfaces.dto;

import jakarta.validation.constraints.NotBlank;

/** Role assignment requested by the admin console. */
public record AdminUserRoleRequest(@NotBlank String role) {}

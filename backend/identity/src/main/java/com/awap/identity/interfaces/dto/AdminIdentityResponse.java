package com.awap.identity.interfaces.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Tenant identity administration read model for the Phase 8 admin console.
 *
 * <p>Every value is computed by the backend from the tenant-scoped identity tables. The console
 * never derives a count from a truncated list, so the users/groups/roles/invitations panels and the
 * quota card cannot disagree with each other.
 */
public record AdminIdentityResponse(
    UUID tenantId,
    String plan,
    int maxUsers,
    int maxWorkflows,
    long maxAiCallsPerMonth,
    long usersUsed,
    long workflowsUsed,
    List<AdminUser> users,
    List<AdminGroup> groups,
    List<AdminRole> roles,
    List<AdminPermission> permissions,
    List<AdminInvitation> invitations) {

  /** One tenant user with the role that currently drives its authorities. */
  public record AdminUser(
      UUID id, String email, String fullName, String role, boolean deleted, Instant createdAt) {}

  /** One organization team, flattened from the company tree with its member count. */
  public record AdminGroup(UUID id, String name, long memberCount) {}

  /** One role and the permissions it grants; the permission matrix renders this verbatim. */
  public record AdminRole(String name, int rank, List<String> permissions) {}

  /** One fine-grained permission constant. */
  public record AdminPermission(String name) {}

  /** One tenant invitation; the one-time token is never included in a list response. */
  public record AdminInvitation(
      UUID id, String email, String role, boolean consumed, Instant expiresAt, Instant createdAt) {}
}

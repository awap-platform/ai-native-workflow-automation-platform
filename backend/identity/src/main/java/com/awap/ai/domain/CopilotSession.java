package com.awap.ai.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A durable Copilot conversation (issue #373). The row is the server-side source of truth so a
 * reload, a second device or a crash cannot erase a thread, and it expires so prompt content has a
 * bounded retention window.
 */
@Entity
@Table(name = "copilot_sessions")
public class CopilotSession {

  @Id
  @Column(nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private UUID tenantId;

  @Column(nullable = false)
  private String title;

  @Column(name = "created_by", nullable = false)
  private UUID createdBy;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @Column(nullable = false)
  private boolean archived;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  protected CopilotSession() {}

  public CopilotSession(UUID tenantId, UUID createdBy, String title, Instant expiresAt) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.createdBy = createdBy;
    this.title = title;
    this.createdAt = Instant.now();
    this.updatedAt = this.createdAt;
    this.archived = false;
    this.expiresAt = expiresAt;
  }

  public UUID getId() {
    return id;
  }

  public UUID getTenantId() {
    return tenantId;
  }

  public String getTitle() {
    return title;
  }

  public UUID getCreatedBy() {
    return createdBy;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }

  public boolean isArchived() {
    return archived;
  }

  public Instant getExpiresAt() {
    return expiresAt;
  }

  /** Keeps the sidebar ordering honest after a turn or a HITL change. */
  public void touch() {
    this.updatedAt = Instant.now();
  }

  public void archive() {
    this.archived = true;
    this.updatedAt = Instant.now();
  }

  public boolean expiredAt(Instant now) {
    return !expiresAt.isAfter(now);
  }
}

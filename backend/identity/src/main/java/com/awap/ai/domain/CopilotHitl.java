package com.awap.ai.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A persisted HITL approval (issue #373). Persisting it is what lets a pending approval survive a
 * crash, and recording the decision here is what makes a replay a 409 instead of a second action.
 */
@Entity
@Table(name = "copilot_hitl")
public class CopilotHitl {

  @Id
  @Column(nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private UUID tenantId;

  @Column(name = "session_id", nullable = false)
  private UUID sessionId;

  @Column(name = "turn_id")
  private UUID turnId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private CopilotHitlStatus state;

  @Column(nullable = false, columnDefinition = "TEXT")
  private String summary;

  @Column(name = "proposal_json", columnDefinition = "TEXT")
  private String proposalJson;

  @Column(name = "decided_by")
  private UUID decidedBy;

  @Column(name = "decided_at")
  private Instant decidedAt;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected CopilotHitl() {}

  public CopilotHitl(
      UUID tenantId, UUID sessionId, UUID turnId, String summary, String proposalJson) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.sessionId = sessionId;
    this.turnId = turnId;
    this.summary = summary;
    this.proposalJson = proposalJson;
    this.state = CopilotHitlStatus.PENDING;
    this.createdAt = Instant.now();
    this.updatedAt = this.createdAt;
  }

  public UUID getId() {
    return id;
  }

  public UUID getTenantId() {
    return tenantId;
  }

  public UUID getSessionId() {
    return sessionId;
  }

  public UUID getTurnId() {
    return turnId;
  }

  public CopilotHitlStatus getState() {
    return state;
  }

  public String getSummary() {
    return summary;
  }

  public String getProposalJson() {
    return proposalJson;
  }

  public UUID getDecidedBy() {
    return decidedBy;
  }

  public Instant getDecidedAt() {
    return decidedAt;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }

  public boolean isPending() {
    return state == CopilotHitlStatus.PENDING;
  }

  /** Records the review decision once; callers must reject an already-decided row first. */
  public void decide(CopilotHitlStatus decision, UUID reviewerId) {
    this.state = decision;
    this.decidedBy = reviewerId;
    this.decidedAt = Instant.now();
    this.updatedAt = this.decidedAt;
  }
}

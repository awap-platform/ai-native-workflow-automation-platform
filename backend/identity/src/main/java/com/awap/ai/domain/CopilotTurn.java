package com.awap.ai.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * One immutable turn of a Copilot conversation (issue #373). Tool calls, citations, budget usage
 * and approval state travel with the turn, and {@code previousHash} chains the turns so a tampered
 * row is detectable without a separate audit table.
 */
@Entity
@Table(name = "copilot_turns")
public class CopilotTurn {

  @Id
  @Column(nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private UUID tenantId;

  @Column(name = "session_id", nullable = false)
  private UUID sessionId;

  @Column(nullable = false)
  private int sequence;

  @Column(nullable = false)
  private String role;

  @Column(nullable = false, columnDefinition = "TEXT")
  private String content;

  @Column(name = "content_hash", nullable = false)
  private String contentHash;

  @Column(name = "previous_hash")
  private String previousHash;

  @Column(name = "tool_calls_json", columnDefinition = "TEXT")
  private String toolCallsJson;

  @Column(name = "citations_json", columnDefinition = "TEXT")
  private String citationsJson;

  @Column(name = "budget_json", columnDefinition = "TEXT")
  private String budgetJson;

  @Column(name = "approval_json", columnDefinition = "TEXT")
  private String approvalJson;

  @Column(name = "idempotency_key")
  private String idempotencyKey;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  protected CopilotTurn() {}

  public CopilotTurn(
      UUID tenantId,
      UUID sessionId,
      int sequence,
      String role,
      String content,
      String contentHash,
      String previousHash,
      String idempotencyKey) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.sessionId = sessionId;
    this.sequence = sequence;
    this.role = role;
    this.content = content;
    this.contentHash = contentHash;
    this.previousHash = previousHash;
    this.idempotencyKey = idempotencyKey;
    this.createdAt = Instant.now();
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

  public int getSequence() {
    return sequence;
  }

  public String getRole() {
    return role;
  }

  public String getContent() {
    return content;
  }

  public String getContentHash() {
    return contentHash;
  }

  public String getPreviousHash() {
    return previousHash;
  }

  public String getToolCallsJson() {
    return toolCallsJson;
  }

  public String getCitationsJson() {
    return citationsJson;
  }

  public String getBudgetJson() {
    return budgetJson;
  }

  public String getApprovalJson() {
    return approvalJson;
  }

  public String getIdempotencyKey() {
    return idempotencyKey;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  /** Attaches the structured payloads that belong to this turn. */
  public void recordDetails(
      String toolCallsJson, String citationsJson, String budgetJson, String approvalJson) {
    this.toolCallsJson = toolCallsJson;
    this.citationsJson = citationsJson;
    this.budgetJson = budgetJson;
    this.approvalJson = approvalJson;
  }
}

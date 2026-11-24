package com.awap.form.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Immutable schema snapshot for one form definition version (issue #370).
 *
 * <p>The submission stores only the version number; this row is the durable, server-resolved schema
 * the respondent actually saw. It is written once and never mutated.
 */
@Entity
@Table(name = "form_schema_snapshots")
public class FormSchemaSnapshot {

  @Id
  @Column(nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private UUID tenantId;

  @Column(name = "form_id", nullable = false)
  private UUID formId;

  @Column(nullable = false)
  private int version;

  @Column(name = "schema_json", nullable = false, columnDefinition = "TEXT")
  private String schemaJson;

  @Column(name = "schema_hash", nullable = false)
  private String schemaHash;

  @Column(nullable = false)
  private Instant createdAt;

  protected FormSchemaSnapshot() {}

  public FormSchemaSnapshot(
      UUID tenantId, UUID formId, int version, String schemaJson, String schemaHash) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.formId = formId;
    this.version = version;
    this.schemaJson = schemaJson;
    this.schemaHash = schemaHash;
    this.createdAt = Instant.now();
  }

  public UUID getId() {
    return id;
  }

  public UUID getTenantId() {
    return tenantId;
  }

  public UUID getFormId() {
    return formId;
  }

  public int getVersion() {
    return version;
  }

  public String getSchemaJson() {
    return schemaJson;
  }

  public String getSchemaHash() {
    return schemaHash;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }
}

package com.awap.task.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** A document file linked to a task; scan status is copied from the document pipeline. */
@Entity
@Table(name = "task_attachments")
public class TaskAttachment {

  @Id
  @Column(nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private UUID tenantId;

  @Column(name = "task_id", nullable = false)
  private UUID taskId;

  @Column(name = "file_id", nullable = false)
  private UUID fileId;

  @Column(name = "file_name", nullable = false)
  private String fileName;

  @Column(name = "scan_status", nullable = false)
  private String scanStatus;

  @Column(name = "created_by", nullable = false)
  private UUID createdBy;

  @Column(nullable = false)
  private Instant createdAt;

  @Column(nullable = false)
  private boolean deleted;

  protected TaskAttachment() {}

  public TaskAttachment(
      UUID tenantId, UUID taskId, UUID fileId, String fileName, String scanStatus, UUID createdBy) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.taskId = taskId;
    this.fileId = fileId;
    this.fileName = fileName;
    this.scanStatus = scanStatus;
    this.createdBy = createdBy;
    this.createdAt = Instant.now();
    this.deleted = false;
  }

  public UUID getId() {
    return id;
  }

  public UUID getTenantId() {
    return tenantId;
  }

  public UUID getTaskId() {
    return taskId;
  }

  public UUID getFileId() {
    return fileId;
  }

  public String getFileName() {
    return fileName;
  }

  public String getScanStatus() {
    return scanStatus;
  }

  public UUID getCreatedBy() {
    return createdBy;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public boolean isDeleted() {
    return deleted;
  }
}

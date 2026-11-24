package com.awap.task.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Tenant-scoped comment on a task (issue #371). */
@Entity
@Table(name = "task_comments")
public class TaskComment {

  @Id
  @Column(nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private UUID tenantId;

  @Column(name = "task_id", nullable = false)
  private UUID taskId;

  @Column(name = "author_id", nullable = false)
  private UUID authorId;

  @Column(nullable = false, columnDefinition = "TEXT")
  private String body;

  @Column(nullable = false)
  private Instant createdAt;

  @Column(nullable = false)
  private Instant updatedAt;

  @Column(nullable = false)
  private boolean deleted;

  protected TaskComment() {}

  public TaskComment(UUID tenantId, UUID taskId, UUID authorId, String body) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.taskId = taskId;
    this.authorId = authorId;
    this.body = body;
    this.createdAt = Instant.now();
    this.updatedAt = this.createdAt;
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

  public UUID getAuthorId() {
    return authorId;
  }

  public String getBody() {
    return body;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }

  public boolean isDeleted() {
    return deleted;
  }

  public void softDelete() {
    this.deleted = true;
    this.updatedAt = Instant.now();
  }
}

package com.awap.task.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Covers the persistence-entity accessors and the soft-delete contract for task collaboration. */
class TaskCollaborationEntitiesTest {

  @Test
  void commentExposesEveryPersistedField() {
    UUID tenantId = UUID.randomUUID();
    UUID taskId = UUID.randomUUID();
    UUID authorId = UUID.randomUUID();

    TaskComment comment = new TaskComment(tenantId, taskId, authorId, "body");

    assertThat(comment.getId()).isNotNull();
    assertThat(comment.getTenantId()).isEqualTo(tenantId);
    assertThat(comment.getTaskId()).isEqualTo(taskId);
    assertThat(comment.getAuthorId()).isEqualTo(authorId);
    assertThat(comment.getBody()).isEqualTo("body");
    assertThat(comment.getCreatedAt()).isNotNull();
    assertThat(comment.getUpdatedAt()).isEqualTo(comment.getCreatedAt());
    assertThat(comment.isDeleted()).isFalse();
  }

  @Test
  void commentSoftDeleteKeepsTheRowAndAdvancesUpdatedAt() {
    TaskComment comment =
        new TaskComment(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "body");
    Instant created = comment.getCreatedAt();

    comment.softDelete();

    assertThat(comment.isDeleted()).isTrue();
    assertThat(comment.getUpdatedAt()).isAfterOrEqualTo(created);
  }

  @Test
  void commentRetainsAJpaNoArgConstructor() throws Exception {
    TaskComment comment = TaskComment.class.getDeclaredConstructor().newInstance();
    assertThat(comment.getId()).isNull();
  }

  @Test
  void attachmentExposesEveryPersistedField() {
    UUID tenantId = UUID.randomUUID();
    UUID taskId = UUID.randomUUID();
    UUID fileId = UUID.randomUUID();
    UUID createdBy = UUID.randomUUID();

    TaskAttachment attachment =
        new TaskAttachment(tenantId, taskId, fileId, "report.pdf", "PROMOTED", createdBy);

    assertThat(attachment.getId()).isNotNull();
    assertThat(attachment.getTenantId()).isEqualTo(tenantId);
    assertThat(attachment.getTaskId()).isEqualTo(taskId);
    assertThat(attachment.getFileId()).isEqualTo(fileId);
    assertThat(attachment.getFileName()).isEqualTo("report.pdf");
    assertThat(attachment.getScanStatus()).isEqualTo("PROMOTED");
    assertThat(attachment.getCreatedBy()).isEqualTo(createdBy);
    assertThat(attachment.getCreatedAt()).isNotNull();
    assertThat(attachment.isDeleted()).isFalse();
  }

  @Test
  void attachmentRetainsAJpaNoArgConstructor() throws Exception {
    TaskAttachment attachment = TaskAttachment.class.getDeclaredConstructor().newInstance();
    assertThat(attachment.getId()).isNull();
  }
}

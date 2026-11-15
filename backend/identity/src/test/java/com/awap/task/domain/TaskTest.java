package com.awap.task.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class TaskTest {

  private final UUID tenantId = UUID.randomUUID();
  private final UUID userA = UUID.randomUUID();
  private final UUID userB = UUID.randomUUID();

  @Test
  void claimAndCompleteHappyPath() {
    Task task = new Task(tenantId, null, null, "Review", null, null);
    task.claim(userA);
    assertThat(task.getStatus()).isEqualTo(TaskStatus.IN_PROGRESS);
    task.complete();
    assertThat(task.getStatus()).isEqualTo(TaskStatus.COMPLETED);
    assertThat(task.getCompletedAt()).isNotNull();
  }

  @Test
  void approveThenApproveAgainIsRejected() {
    Task task = new Task(tenantId, null, null, "Approve", null, userA);
    task.claim(userA);
    task.approve();
    assertThat(task.getStatus()).isEqualTo(TaskStatus.APPROVED);
    assertThatThrownBy(task::approve).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void assignedTaskCannotBeClaimedByAnotherUser() {
    Task task = new Task(tenantId, null, null, "Task", null, userA);
    assertThatThrownBy(() -> task.claim(userB)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void reassignMovesTaskToAnotherUser() {
    Task task = new Task(tenantId, null, null, "Task", null, userA);
    task.reassign(userB);
    assertThat(task.getAssigneeId()).isEqualTo(userB);
    assertThat(task.getStatus()).isEqualTo(TaskStatus.ASSIGNED);
  }

  @Test
  void approvalTaskCarriesTypeAndSlaDeadline() {
    java.time.Instant deadline = java.time.Instant.parse("2026-11-15T12:00:00Z");
    Task task = new Task(tenantId, null, null, "Approve", null, userA, TaskType.APPROVAL, deadline);

    assertThat(task.getTaskType()).isEqualTo(TaskType.APPROVAL);
    assertThat(task.getEscalateAt()).isEqualTo(deadline);
    assertThat(task.isEscalated()).isFalse();
  }

  @Test
  void genericTaskDefaultsToGenericType() {
    Task task = new Task(tenantId, null, null, "Task", null, null);
    Task nullType = new Task(tenantId, null, null, "Task", null, null, null, null);

    assertThat(task.getTaskType()).isEqualTo(TaskType.GENERIC);
    assertThat(task.getEscalateAt()).isNull();
    assertThat(nullType.getTaskType()).isEqualTo(TaskType.GENERIC);
  }

  @Test
  void escalateSetsDeadlineAndAssignee() {
    Task task = new Task(tenantId, null, null, "Task", null, null);
    task.escalate(userA, java.time.Instant.now().plusSeconds(60));
    assertThat(task.isEscalated()).isTrue();
    assertThat(task.getAssigneeId()).isEqualTo(userA);
  }

  @Test
  void escalationAppliedIsADurableIdempotencyGuard() {
    Task task = new Task(tenantId, null, null, "Task", null, userA);
    assertThat(task.isEscalationApplied()).isFalse();

    task.markEscalationApplied(java.time.Instant.parse("2026-06-01T10:00:00Z"));

    assertThat(task.isEscalationApplied()).isTrue();
    assertThat(task.getEscalationAppliedAt())
        .isEqualTo(java.time.Instant.parse("2026-06-01T10:00:00Z"));
  }
}

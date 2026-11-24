package com.awap.task.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.engine.application.OutboxEventPublisher;
import com.awap.file.application.FileService;
import com.awap.file.domain.FileScanStatus;
import com.awap.task.domain.Task;
import com.awap.task.domain.TaskAttachment;
import com.awap.task.domain.TaskComment;
import com.awap.task.infrastructure.TaskAttachmentRepository;
import com.awap.task.infrastructure.TaskCommentRepository;
import com.awap.task.infrastructure.TaskRepository;
import com.awap.task.interfaces.dto.TaskAttachmentResponse;
import com.awap.task.interfaces.dto.TaskCommentResponse;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TaskCollaborationServiceTest {

  @Mock private TaskRepository taskRepository;
  @Mock private TaskCommentRepository commentRepository;
  @Mock private TaskAttachmentRepository attachmentRepository;
  @Mock private FileService fileService;
  @Mock private OutboxEventPublisher outboxEventPublisher;

  private TaskCollaborationService service;
  private final UUID tenantId = UUID.randomUUID();
  private final UUID taskId = UUID.randomUUID();
  private final UUID userId = UUID.randomUUID();

  @BeforeEach
  void setUp() {
    service =
        new TaskCollaborationService(
            taskRepository,
            commentRepository,
            attachmentRepository,
            fileService,
            outboxEventPublisher);
  }

  private Task task() {
    Task task = new Task(tenantId, UUID.randomUUID(), UUID.randomUUID(), "Review", "Body", userId);
    return task;
  }

  private void stubTask() {
    when(taskRepository.findByIdAndTenantIdAndDeletedFalse(taskId, tenantId))
        .thenReturn(Optional.of(task()));
  }

  @Test
  void addCommentTrimsAndPublishesTheAuditEvent() {
    stubTask();
    when(commentRepository.save(any(TaskComment.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));

    TaskCommentResponse response = service.addComment(tenantId, taskId, userId, "  hello  ");

    assertThat(response.body()).isEqualTo("hello");
    assertThat(response.authorId()).isEqualTo(userId);
    verify(outboxEventPublisher).publish(any(), any(), any(), any(), any());
  }

  @Test
  void addCommentRejectsEmptyAndOversizedBodies() {
    stubTask();
    assertThatThrownBy(() -> service.addComment(tenantId, taskId, userId, "  "))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("cannot be empty");
    assertThatThrownBy(() -> service.addComment(tenantId, taskId, userId, "x".repeat(10_001)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("cannot exceed");
  }

  @Test
  void addCommentRejectsAForeignTask() {
    when(taskRepository.findByIdAndTenantIdAndDeletedFalse(taskId, tenantId))
        .thenReturn(Optional.empty());
    assertThatThrownBy(() -> service.addComment(tenantId, taskId, userId, "hello"))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void commentsAreReturnedInChronologicalOrder() {
    stubTask();
    TaskComment comment = new TaskComment(tenantId, taskId, userId, "hello");
    when(commentRepository.findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(
            tenantId, taskId))
        .thenReturn(List.of(comment));

    List<TaskCommentResponse> comments = service.comments(tenantId, taskId);

    assertThat(comments).hasSize(1);
    assertThat(comments.get(0).body()).isEqualTo("hello");
  }

  @Test
  void attachCopiesTheDocumentScanState() {
    stubTask();
    UUID fileId = UUID.randomUUID();
    when(fileService.scanInfo(tenantId, fileId))
        .thenReturn(
            new FileService.FileScanInfo(fileId, "report.pdf", FileScanStatus.PROMOTED, null));
    when(attachmentRepository.save(any(TaskAttachment.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));

    TaskAttachmentResponse response = service.attach(tenantId, taskId, fileId, userId);

    assertThat(response.fileName()).isEqualTo("report.pdf");
    assertThat(response.scanStatus()).isEqualTo("PROMOTED");
    assertThat(response.downloadable()).isTrue();
    verify(outboxEventPublisher).publish(any(), any(), any(), any(), any());
  }

  @Test
  void attachmentsListPreservesNonDownloadableScanStates() {
    stubTask();
    UUID fileId = UUID.randomUUID();
    TaskAttachment attachment =
        new TaskAttachment(tenantId, taskId, fileId, "virus.pdf", "QUARANTINED", userId);
    when(attachmentRepository.findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(
            tenantId, taskId))
        .thenReturn(List.of(attachment));

    List<TaskAttachmentResponse> attachments = service.attachments(tenantId, taskId);

    assertThat(attachments).hasSize(1);
    assertThat(attachments.get(0).downloadable()).isFalse();
  }

  @Test
  void deleteCommentSoftDeletesTheAuthorsOwnComment() {
    stubTask();
    TaskComment comment = new TaskComment(tenantId, taskId, userId, "hello");
    when(commentRepository.findByIdAndTenantIdAndDeletedFalse(comment.getId(), tenantId))
        .thenReturn(Optional.of(comment));

    service.deleteComment(tenantId, taskId, comment.getId(), userId);

    assertThat(comment.isDeleted()).isTrue();
    assertThat(comment.getUpdatedAt()).isAfterOrEqualTo(comment.getCreatedAt());
    verify(commentRepository).save(comment);
    verify(outboxEventPublisher).publish(any(), any(), any(), any(), any());
  }

  @Test
  void deleteCommentRejectsAnotherAuthor() {
    stubTask();
    UUID commentId = UUID.randomUUID();
    TaskComment comment = new TaskComment(tenantId, taskId, UUID.randomUUID(), "hello");
    when(commentRepository.findByIdAndTenantIdAndDeletedFalse(commentId, tenantId))
        .thenReturn(Optional.of(comment));

    assertThatThrownBy(() -> service.deleteComment(tenantId, taskId, commentId, userId))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Only the author");
    assertThat(comment.isDeleted()).isFalse();
  }

  @Test
  void deleteCommentRejectsAMissingOrForeignComment() {
    stubTask();
    UUID commentId = UUID.randomUUID();
    UUID otherTaskId = UUID.randomUUID();
    when(commentRepository.findByIdAndTenantIdAndDeletedFalse(commentId, tenantId))
        .thenReturn(Optional.empty());
    assertThatThrownBy(() -> service.deleteComment(tenantId, taskId, commentId, userId))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("comment was not found");

    TaskComment foreign = new TaskComment(tenantId, otherTaskId, userId, "hello");
    when(commentRepository.findByIdAndTenantIdAndDeletedFalse(foreign.getId(), tenantId))
        .thenReturn(Optional.of(foreign));
    assertThatThrownBy(() -> service.deleteComment(tenantId, taskId, foreign.getId(), userId))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("comment was not found");
  }

  @Test
  void activityMergesTaskCommentsAttachmentsAndDecision() {
    Task task = task();
    task.approve("Looks good");
    when(taskRepository.findByIdAndTenantIdAndDeletedFalse(taskId, tenantId))
        .thenReturn(Optional.of(task));
    when(commentRepository.findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(
            tenantId, taskId))
        .thenReturn(List.of(new TaskComment(tenantId, taskId, userId, "comment")));
    when(attachmentRepository.findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(
            tenantId, taskId))
        .thenReturn(
            List.of(
                new TaskAttachment(
                    tenantId, taskId, UUID.randomUUID(), "file.pdf", "PROMOTED", userId)));

    var activity = service.activity(tenantId, taskId);

    assertThat(activity)
        .extracting(entry -> entry.kind())
        .contains("TASK_CREATED", "TASK_UPDATED", "TASK_DECIDED", "COMMENT", "ATTACHMENT");
    assertThat(activity.get(0).createdAt())
        .isAfterOrEqualTo(activity.get(activity.size() - 1).createdAt());
  }
}

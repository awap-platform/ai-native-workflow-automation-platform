package com.awap.task.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.engine.application.OutboxEventPublisher;
import com.awap.file.application.FileService;
import com.awap.task.domain.Task;
import com.awap.task.domain.TaskAttachment;
import com.awap.task.domain.TaskComment;
import com.awap.task.infrastructure.TaskAttachmentRepository;
import com.awap.task.infrastructure.TaskCommentRepository;
import com.awap.task.infrastructure.TaskRepository;
import com.awap.task.interfaces.dto.TaskActivityResponse;
import com.awap.task.interfaces.dto.TaskAttachmentResponse;
import com.awap.task.interfaces.dto.TaskCommentResponse;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Task collaboration use cases (issue #371): comments, attachment links and the unified activity
 * stream. Actor identity always comes from the authenticated session.
 */
@Service
public class TaskCollaborationService {

  private static final int MAX_COMMENT_LENGTH = 10_000;

  private final TaskRepository taskRepository;
  private final TaskCommentRepository commentRepository;
  private final TaskAttachmentRepository attachmentRepository;
  private final FileService fileService;
  private final OutboxEventPublisher outboxEventPublisher;

  public TaskCollaborationService(
      TaskRepository taskRepository,
      TaskCommentRepository commentRepository,
      TaskAttachmentRepository attachmentRepository,
      FileService fileService,
      OutboxEventPublisher outboxEventPublisher) {
    this.taskRepository = taskRepository;
    this.commentRepository = commentRepository;
    this.attachmentRepository = attachmentRepository;
    this.fileService = fileService;
    this.outboxEventPublisher = outboxEventPublisher;
  }

  @Transactional
  public TaskCommentResponse addComment(UUID tenantId, UUID taskId, UUID authorId, String body) {
    Task task = requireTask(tenantId, taskId);
    String trimmed = body == null ? "" : body.trim();
    if (trimmed.isEmpty()) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "A comment cannot be empty.");
    }
    if (trimmed.length() > MAX_COMMENT_LENGTH) {
      throw new AwapException(
          ErrorCode.PAYLOAD_TOO_LARGE,
          HttpStatus.PAYLOAD_TOO_LARGE,
          "A comment cannot exceed " + MAX_COMMENT_LENGTH + " characters.");
    }
    TaskComment comment = new TaskComment(tenantId, taskId, authorId, trimmed);
    commentRepository.save(comment);
    outboxEventPublisher.publish(
        tenantId,
        "TASK",
        task.getId(),
        "TASK_COMMENT_ADDED",
        Map.of("commentId", comment.getId(), "authorId", authorId));
    return toResponse(comment);
  }

  public List<TaskCommentResponse> comments(UUID tenantId, UUID taskId) {
    requireTask(tenantId, taskId);
    return commentRepository
        .findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(tenantId, taskId)
        .stream()
        .map(TaskCollaborationService::toResponse)
        .toList();
  }

  @Transactional
  public TaskAttachmentResponse attach(UUID tenantId, UUID taskId, UUID fileId, UUID actorId) {
    Task task = requireTask(tenantId, taskId);
    FileService.FileScanInfo info = fileService.scanInfo(tenantId, fileId);
    TaskAttachment attachment =
        new TaskAttachment(tenantId, taskId, fileId, info.name(), info.status().name(), actorId);
    attachmentRepository.save(attachment);
    outboxEventPublisher.publish(
        tenantId,
        "TASK",
        task.getId(),
        "TASK_ATTACHMENT_ADDED",
        Map.of("attachmentId", attachment.getId(), "fileId", fileId));
    return toResponse(attachment);
  }

  public List<TaskAttachmentResponse> attachments(UUID tenantId, UUID taskId) {
    requireTask(tenantId, taskId);
    return attachmentRepository
        .findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(tenantId, taskId)
        .stream()
        .map(TaskCollaborationService::toResponse)
        .toList();
  }

  /**
   * Merges comments, attachment links and task lifecycle fields into one chronological stream. The
   * lifecycle entries are derived from the authoritative task row; comment and attachment entries
   * come from their own tables.
   */
  public List<TaskActivityResponse> activity(UUID tenantId, UUID taskId) {
    Task task = requireTask(tenantId, taskId);
    List<TaskActivityResponse> entries = new ArrayList<>();
    entries.add(
        new TaskActivityResponse(
            "task-created", "TASK_CREATED", null, "Task created", task.getCreatedAt()));
    if (task.getUpdatedAt() != null && !task.getUpdatedAt().equals(task.getCreatedAt())) {
      entries.add(
          new TaskActivityResponse(
              "task-updated",
              "TASK_UPDATED",
              task.getAssigneeId(),
              "Task updated (" + task.getStatus().name() + ")",
              task.getUpdatedAt()));
    }
    if (task.getDecisionComment() != null && !task.getDecisionComment().isBlank()) {
      entries.add(
          new TaskActivityResponse(
              "task-decision",
              "TASK_DECIDED",
              null,
              "Decision: " + task.getDecisionComment(),
              task.getCompletedAt() == null ? task.getUpdatedAt() : task.getCompletedAt()));
    }
    for (TaskComment comment :
        commentRepository.findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(
            tenantId, taskId)) {
      entries.add(
          new TaskActivityResponse(
              "comment-" + comment.getId(),
              "COMMENT",
              comment.getAuthorId(),
              comment.getBody(),
              comment.getCreatedAt()));
    }
    for (TaskAttachment attachment :
        attachmentRepository.findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(
            tenantId, taskId)) {
      entries.add(
          new TaskActivityResponse(
              "attachment-" + attachment.getId(),
              "ATTACHMENT",
              attachment.getCreatedBy(),
              "Attached " + attachment.getFileName() + " (" + attachment.getScanStatus() + ")",
              attachment.getCreatedAt()));
    }
    entries.sort(Comparator.comparing(TaskActivityResponse::createdAt).reversed());
    return entries;
  }

  private Task requireTask(UUID tenantId, UUID taskId) {
    return taskRepository
        .findByIdAndTenantIdAndDeletedFalse(taskId, tenantId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.TASK_NOT_FOUND, HttpStatus.NOT_FOUND, "The task was not found."));
  }

  private static TaskCommentResponse toResponse(TaskComment comment) {
    return new TaskCommentResponse(
        comment.getId(),
        comment.getTaskId(),
        comment.getAuthorId(),
        comment.getBody(),
        comment.getCreatedAt());
  }

  private static TaskAttachmentResponse toResponse(TaskAttachment attachment) {
    return new TaskAttachmentResponse(
        attachment.getId(),
        attachment.getTaskId(),
        attachment.getFileId(),
        attachment.getFileName(),
        attachment.getScanStatus(),
        "PROMOTED".equals(attachment.getScanStatus()),
        attachment.getCreatedBy(),
        attachment.getCreatedAt());
  }
}

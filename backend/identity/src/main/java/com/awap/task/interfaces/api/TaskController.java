package com.awap.task.interfaces.api;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.task.application.TaskCollaborationService;
import com.awap.task.application.TaskService;
import com.awap.task.interfaces.dto.TaskActivityResponse;
import com.awap.task.interfaces.dto.TaskAssignRequest;
import com.awap.task.interfaces.dto.TaskAttachmentRequest;
import com.awap.task.interfaces.dto.TaskAttachmentResponse;
import com.awap.task.interfaces.dto.TaskCommentRequest;
import com.awap.task.interfaces.dto.TaskCommentResponse;
import com.awap.task.interfaces.dto.TaskDecisionRequest;
import com.awap.task.interfaces.dto.TaskRequest;
import com.awap.task.interfaces.dto.TaskResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Task endpoints: create, list, assign, claim, approve, reject and complete. */
@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {

  private final TaskService taskService;
  private final TaskCollaborationService collaborationService;

  public TaskController(TaskService taskService, TaskCollaborationService collaborationService) {
    this.taskService = taskService;
    this.collaborationService = collaborationService;
  }

  @PostMapping
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<TaskResponse> create(@Valid @RequestBody TaskRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(taskService.create(currentTenantId(), request));
  }

  @GetMapping
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<List<TaskResponse>> list() {
    return ResponseEntity.ok(taskService.list(currentTenantId()));
  }

  @GetMapping("/mine")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<List<TaskResponse>> listMine() {
    return ResponseEntity.ok(taskService.listMine(currentTenantId(), currentUserId()));
  }

  @GetMapping("/{id}/comments")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<List<TaskCommentResponse>> comments(@PathVariable UUID id) {
    return ResponseEntity.ok(collaborationService.comments(currentTenantId(), id));
  }

  @PostMapping("/{id}/comments")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<TaskCommentResponse> addComment(
      @PathVariable UUID id, @Valid @RequestBody TaskCommentRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            collaborationService.addComment(
                currentTenantId(), id, currentUserId(), request.body()));
  }

  @DeleteMapping("/{id}/comments/{commentId}")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<Void> deleteComment(
      @PathVariable UUID id, @PathVariable UUID commentId) {
    collaborationService.deleteComment(currentTenantId(), id, commentId, currentUserId());
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/{id}/attachments")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<List<TaskAttachmentResponse>> attachments(@PathVariable UUID id) {
    return ResponseEntity.ok(collaborationService.attachments(currentTenantId(), id));
  }

  @PostMapping("/{id}/attachments")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<TaskAttachmentResponse> attach(
      @PathVariable UUID id, @Valid @RequestBody TaskAttachmentRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            collaborationService.attach(currentTenantId(), id, request.fileId(), currentUserId()));
  }

  @GetMapping("/{id}/activity")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<List<TaskActivityResponse>> activity(@PathVariable UUID id) {
    return ResponseEntity.ok(collaborationService.activity(currentTenantId(), id));
  }

  @PostMapping("/{id}/assign")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<TaskResponse> assign(
      @PathVariable UUID id, @Valid @RequestBody TaskAssignRequest request) {
    return ResponseEntity.ok(taskService.assign(currentTenantId(), id, request));
  }

  @PostMapping("/{id}/claim")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<TaskResponse> claim(@PathVariable UUID id) {
    return ResponseEntity.ok(taskService.claim(currentTenantId(), id, currentUserId()));
  }

  /**
   * Escalates a task to another assignee and restarts its one-hour SLA window. The UI shows the new
   * deadline from the response instead of computing it locally.
   */
  @PostMapping("/{id}/escalate")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<TaskResponse> escalate(
      @PathVariable UUID id, @Valid @RequestBody TaskAssignRequest request) {
    return ResponseEntity.ok(taskService.escalate(currentTenantId(), id, request));
  }

  @PostMapping("/{id}/approve")
  @PreAuthorize("hasAuthority('TASK_APPROVE')")
  public ResponseEntity<TaskResponse> approve(
      @PathVariable UUID id, @RequestBody(required = false) TaskDecisionRequest request) {
    String comment = request != null ? request.comment() : null;
    return ResponseEntity.ok(
        taskService.approve(currentTenantId(), id, currentUserId(), currentRole(), comment));
  }

  @PostMapping("/{id}/reject")
  @PreAuthorize("hasAuthority('TASK_APPROVE')")
  public ResponseEntity<TaskResponse> reject(
      @PathVariable UUID id, @RequestBody(required = false) TaskDecisionRequest request) {
    String comment = request != null ? request.comment() : null;
    return ResponseEntity.ok(
        taskService.reject(currentTenantId(), id, currentUserId(), currentRole(), comment));
  }

  @PostMapping("/{id}/complete")
  @PreAuthorize("hasAuthority('TASK_MANAGE')")
  public ResponseEntity<TaskResponse> complete(@PathVariable UUID id) {
    return ResponseEntity.ok(taskService.complete(currentTenantId(), id));
  }

  private UUID currentTenantId() {
    return TenantContext.current()
        .map(TenantContext.Context::tenantId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.UNAUTHORIZED,
                    HttpStatus.UNAUTHORIZED,
                    "Authentication is required."));
  }

  private String currentRole() {
    return TenantContext.current()
        .map(TenantContext.Context::role)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.UNAUTHORIZED,
                    HttpStatus.UNAUTHORIZED,
                    "Authentication is required."));
  }

  private UUID currentUserId() {
    return TenantContext.current()
        .map(TenantContext.Context::userId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.UNAUTHORIZED,
                    HttpStatus.UNAUTHORIZED,
                    "Authentication is required."));
  }
}

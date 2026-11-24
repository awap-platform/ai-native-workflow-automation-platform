package com.awap.task.interfaces.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.identity.IdentityApplication;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.task.application.TaskCollaborationService;
import com.awap.task.application.TaskService;
import com.awap.task.interfaces.dto.TaskActivityResponse;
import com.awap.task.interfaces.dto.TaskAttachmentResponse;
import com.awap.task.interfaces.dto.TaskCommentResponse;
import com.awap.task.interfaces.dto.TaskResponse;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest(classes = IdentityApplication.class)
class TaskControllerWebMvcTest {

  @Autowired private WebApplicationContext context;
  @MockitoBean private TaskService taskService;
  @MockitoBean private TaskCollaborationService collaborationService;

  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    TenantContext.set(UUID.randomUUID(), UUID.randomUUID(), "MANAGER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void commentsListReturnsOk() throws Exception {
    UUID taskId = UUID.randomUUID();
    when(collaborationService.comments(any(UUID.class), eq(taskId))).thenReturn(List.of());

    mockMvc
        .perform(
            get("/api/v1/tasks/{id}/comments", taskId)
                .with(user("u").authorities(new SimpleGrantedAuthority("TASK_MANAGE"))))
        .andExpect(status().isOk());
  }

  @Test
  void addCommentReturnsCreated() throws Exception {
    UUID taskId = UUID.randomUUID();
    UUID author = UUID.randomUUID();
    when(collaborationService.addComment(any(UUID.class), eq(taskId), any(UUID.class), eq("hi")))
        .thenReturn(
            new TaskCommentResponse(
                UUID.randomUUID(), taskId, author, "hi", Instant.parse("2026-01-01T00:00:00Z")));

    mockMvc
        .perform(
            post("/api/v1/tasks/{id}/comments", taskId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"hi\"}")
                .with(user("u").authorities(new SimpleGrantedAuthority("TASK_MANAGE"))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.body").value("hi"));
  }

  @Test
  void attachmentsListReturnsOk() throws Exception {
    UUID taskId = UUID.randomUUID();
    when(collaborationService.attachments(any(UUID.class), eq(taskId))).thenReturn(List.of());

    mockMvc
        .perform(
            get("/api/v1/tasks/{id}/attachments", taskId)
                .with(user("u").authorities(new SimpleGrantedAuthority("TASK_MANAGE"))))
        .andExpect(status().isOk());
  }

  @Test
  void attachReturnsCreated() throws Exception {
    UUID taskId = UUID.randomUUID();
    UUID fileId = UUID.randomUUID();
    when(collaborationService.attach(any(UUID.class), eq(taskId), any(UUID.class), any(UUID.class)))
        .thenReturn(
            new TaskAttachmentResponse(
                UUID.randomUUID(),
                taskId,
                fileId,
                "file.pdf",
                "PROMOTED",
                true,
                UUID.randomUUID(),
                Instant.parse("2026-01-01T00:00:00Z")));

    mockMvc
        .perform(
            post("/api/v1/tasks/{id}/attachments", taskId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fileId\":\"" + fileId + "\"}")
                .with(user("u").authorities(new SimpleGrantedAuthority("TASK_MANAGE"))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.downloadable").value(true));
  }

  @Test
  void activityReturnsTheChronologicalStream() throws Exception {
    UUID taskId = UUID.randomUUID();
    when(collaborationService.activity(any(UUID.class), eq(taskId)))
        .thenReturn(
            List.of(
                new TaskActivityResponse(
                    "comment-1", "COMMENT", UUID.randomUUID(), "hi", Instant.EPOCH)));

    mockMvc
        .perform(
            get("/api/v1/tasks/{id}/activity", taskId)
                .with(user("u").authorities(new SimpleGrantedAuthority("TASK_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].kind").value("COMMENT"));
  }

  @Test
  void listRequiresTaskManageAuthority() throws Exception {
    when(taskService.list(any(UUID.class))).thenReturn(List.of());

    mockMvc
        .perform(
            get("/api/v1/tasks")
                .with(user("user").authorities(new SimpleGrantedAuthority("TASK_MANAGE"))))
        .andExpect(status().isOk());
  }

  @Test
  void listForbiddenWithoutAuthority() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/tasks")
                .with(user("user").authorities(new SimpleGrantedAuthority("ROLE_EMPLOYEE"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void listUnauthenticatedReturns401() throws Exception {
    mockMvc.perform(get("/api/v1/tasks")).andExpect(status().isUnauthorized());
  }

  @Test
  void approveWithCommentPassesCommentToService() throws Exception {
    UUID id = UUID.randomUUID();
    when(taskService.approve(
            any(UUID.class),
            any(UUID.class),
            any(UUID.class),
            any(String.class),
            any(String.class)))
        .thenReturn(taskResponse());

    mockMvc
        .perform(
            post("/api/v1/tasks/{id}/approve", id)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"comment\":\"Looks good\"}")
                .with(csrf())
                .with(user("user").authorities(new SimpleGrantedAuthority("TASK_APPROVE"))))
        .andExpect(status().isOk());

    verify(taskService)
        .approve(any(UUID.class), eq(id), any(UUID.class), any(String.class), eq("Looks good"));
  }

  @Test
  void approveWithoutBodySucceedsWithNullComment() throws Exception {
    UUID id = UUID.randomUUID();
    when(taskService.approve(
            any(UUID.class),
            any(UUID.class),
            any(UUID.class),
            any(String.class),
            any(String.class)))
        .thenReturn(taskResponse());

    mockMvc
        .perform(
            post("/api/v1/tasks/{id}/approve", id)
                .with(csrf())
                .with(user("user").authorities(new SimpleGrantedAuthority("TASK_APPROVE"))))
        .andExpect(status().isOk());

    verify(taskService)
        .approve(any(UUID.class), eq(id), any(UUID.class), any(String.class), isNull());
  }

  @Test
  void rejectWithCommentPassesCommentToService() throws Exception {
    UUID id = UUID.randomUUID();
    when(taskService.reject(
            any(UUID.class),
            any(UUID.class),
            any(UUID.class),
            any(String.class),
            any(String.class)))
        .thenReturn(taskResponse());

    mockMvc
        .perform(
            post("/api/v1/tasks/{id}/reject", id)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"comment\":\"Needs rework\"}")
                .with(csrf())
                .with(user("user").authorities(new SimpleGrantedAuthority("TASK_APPROVE"))))
        .andExpect(status().isOk());

    verify(taskService)
        .reject(any(UUID.class), eq(id), any(UUID.class), any(String.class), eq("Needs rework"));
  }

  @Test
  void escalatePassesTheNewAssigneeToTheService() throws Exception {
    UUID id = UUID.randomUUID();
    UUID assignee = UUID.randomUUID();
    when(taskService.escalate(any(UUID.class), eq(id), any())).thenReturn(taskResponse());

    mockMvc
        .perform(
            post("/api/v1/tasks/{id}/escalate", id)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"assigneeId\":\"" + assignee + "\"}")
                .with(csrf())
                .with(user("user").authorities(new SimpleGrantedAuthority("TASK_MANAGE"))))
        .andExpect(status().isOk());

    verify(taskService)
        .escalate(
            any(UUID.class), eq(id), argThat(request -> assignee.equals(request.assigneeId())));
  }

  @Test
  void deleteCommentReturns204AndScopesItToTheTask() throws Exception {
    UUID taskId = UUID.randomUUID();
    UUID commentId = UUID.randomUUID();

    mockMvc
        .perform(
            delete("/api/v1/tasks/{id}/comments/{commentId}", taskId, commentId)
                .with(csrf())
                .with(user("user").authorities(new SimpleGrantedAuthority("TASK_MANAGE"))))
        .andExpect(status().isNoContent());

    verify(collaborationService)
        .deleteComment(any(UUID.class), eq(taskId), eq(commentId), any(UUID.class));
  }

  @Test
  void deleteCommentForbiddenWithoutAuthority() throws Exception {
    UUID taskId = UUID.randomUUID();
    UUID commentId = UUID.randomUUID();

    mockMvc
        .perform(
            delete("/api/v1/tasks/{id}/comments/{commentId}", taskId, commentId)
                .with(csrf())
                .with(user("user").authorities(new SimpleGrantedAuthority("ROLE_EMPLOYEE"))))
        .andExpect(status().isForbidden());
  }

  private TaskResponse taskResponse() {
    return new TaskResponse(
        UUID.randomUUID(),
        UUID.randomUUID(),
        null,
        "Review",
        null,
        UUID.randomUUID(),
        "APPROVED",
        0L,
        null,
        "GENERIC",
        false,
        null,
        Instant.parse("2026-01-01T00:00:00Z"),
        Instant.parse("2026-01-01T00:00:00Z"),
        null);
  }
}

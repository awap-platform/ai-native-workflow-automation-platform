package com.awap.ai.interfaces.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.ai.application.InternalAiToolAuth;
import com.awap.ai.domain.AutomationAudit;
import com.awap.ai.infrastructure.AutomationAuditRepository;
import com.awap.common.api.AwapException;
import com.awap.common.knowledge.KnowledgeSearchService;
import com.awap.engine.application.OutboxEventPublisher;
import com.awap.engine.application.WorkflowEngineService;
import com.awap.engine.interfaces.dto.StartWorkflowRequest;
import com.awap.engine.interfaces.dto.WorkflowInstanceResponse;
import com.awap.identity.domain.Role;
import com.awap.identity.domain.User;
import com.awap.identity.infrastructure.UserRepository;
import com.awap.task.application.TaskService;
import com.awap.task.interfaces.dto.TaskAssignRequest;
import com.awap.task.interfaces.dto.TaskRequest;
import com.awap.task.interfaces.dto.TaskResponse;
import com.awap.workflow.application.WorkflowDefinitionService;
import com.awap.workflow.interfaces.dto.WorkflowDefinitionResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Contract tests for the internal tool API surface the AI layer calls. Every route must verify the
 * caller through {@link InternalAiToolAuth} and only then delegate to a domain service.
 */
class InternalAiToolControllerTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final InternalAiToolAuth auth = mock(InternalAiToolAuth.class);
  private final WorkflowDefinitionService definitions = mock(WorkflowDefinitionService.class);
  private final WorkflowEngineService engine = mock(WorkflowEngineService.class);
  private final TaskService tasks = mock(TaskService.class);
  private final OutboxEventPublisher outbox = mock(OutboxEventPublisher.class);
  private final KnowledgeSearchService knowledge = mock(KnowledgeSearchService.class);
  private final UserRepository users = mock(UserRepository.class);
  private final AutomationAuditRepository audits = mock(AutomationAuditRepository.class);
  private final HttpServletRequest request = mock(HttpServletRequest.class);

  private final UUID tenantId = UUID.randomUUID();
  private final UUID userId = UUID.randomUUID();

  private InternalAiToolController controller;

  @BeforeEach
  void setUp() {
    controller =
        new InternalAiToolController(
            auth, definitions, engine, tasks, outbox, knowledge, users, audits, objectMapper);
    InternalAiToolAuth.Caller caller =
        new InternalAiToolAuth.Caller(tenantId, userId, Role.TENANT_ADMIN);
    when(auth.authenticate(any(), any())).thenReturn(caller);
    when(auth.inTenant(any(), any()))
        .thenAnswer(invocation -> ((Supplier<?>) invocation.getArgument(1)).get());
  }

  @Test
  void findWorkflowKeepsPublishedDefinitionsAndMatchesNormalizedTokens() throws Exception {
    when(definitions.list(tenantId))
        .thenReturn(
            List.of(
                definition("Leave Request", "Annual leave request", "PUBLISHED"),
                definition("Expense Report", "Travel expenses", "PUBLISHED"),
                definition("Leave Draft", "Not visible", "DRAFT")));

    List<Map<String, Object>> result =
        controller.findWorkflow(json("{\"query\": \"izin talebi başlat\"}"), request);

    assertThat(result).hasSize(1);
    assertThat(result.getFirst()).containsEntry("name", "Leave Request");
  }

  @Test
  void findWorkflowWithoutTokensReturnsEveryPublishedDefinition() throws Exception {
    when(definitions.list(tenantId))
        .thenReturn(List.of(definition("Leave Request", null, "PUBLISHED")));

    assertThat(controller.findWorkflow(json("{}"), request)).hasSize(1);
  }

  @Test
  void findWorkflowRejectsAMissingBodyBeforeAuthenticating() {
    assertThatThrownBy(() -> controller.findWorkflow(null, request))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(400));
    verify(auth, never()).authenticate(any(), any());
  }

  @Test
  void createWorkflowInstanceReturnsTheStartedInstance() throws Exception {
    UUID workflowId = UUID.randomUUID();
    UUID instanceId = UUID.randomUUID();
    when(engine.start(eq(tenantId), any(StartWorkflowRequest.class)))
        .thenReturn(
            new WorkflowInstanceResponse(
                instanceId, tenantId, workflowId, 3, "RUNNING", "{}", "key-1", null));

    Map<String, Object> result =
        controller.createWorkflowInstance(
            json(
                "{\"workflowId\":\""
                    + workflowId
                    + "\",\"context\":{\"amount\":10},\"idempotencyKey\":\"key-1\"}"),
            request);

    assertThat(result)
        .containsEntry("id", instanceId)
        .containsEntry("workflowVersion", 3)
        .containsEntry("state", "RUNNING")
        .containsEntry("idempotencyKey", "key-1");
    ArgumentCaptor<StartWorkflowRequest> captor =
        ArgumentCaptor.forClass(StartWorkflowRequest.class);
    verify(engine).start(eq(tenantId), captor.capture());
    assertThat(captor.getValue().contextJson()).contains("10");
  }

  @Test
  void createWorkflowInstanceRejectsANonUuidIdentifier() {
    assertThatThrownBy(
            () -> controller.createWorkflowInstance(json("{\"workflowId\":\"nope\"}"), request))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("must be a UUID");
  }

  @Test
  void queryTasksDefaultsToTheCallersOwnTasks() {
    when(tasks.listMine(tenantId, userId)).thenReturn(List.of(task()));

    assertThat(controller.queryTasks(null, request)).hasSize(1);
    verify(tasks).listMine(tenantId, userId);
  }

  @Test
  void queryTasksCanListTheWholeTenant() throws Exception {
    when(tasks.list(tenantId)).thenReturn(List.of(task(), task()));

    assertThat(controller.queryTasks(json("{\"mine\":false}"), request)).hasSize(2);
    verify(tasks, never()).listMine(any(), any());
  }

  @Test
  void completeTaskDispatchesApprovalRejectionAndCompletion() throws Exception {
    UUID taskId = UUID.randomUUID();
    when(tasks.approve(any(), any(), any(), any(), any())).thenReturn(task());
    when(tasks.reject(any(), any(), any(), any(), any())).thenReturn(task());
    when(tasks.complete(any(), any())).thenReturn(task());

    controller.completeTask(
        json("{\"taskId\":\"" + taskId + "\",\"decision\":\"approve\"}"), request);
    controller.completeTask(
        json("{\"taskId\":\"" + taskId + "\",\"decision\":\"REJECT\",\"comment\":\"no\"}"),
        request);
    controller.completeTask(json("{\"taskId\":\"" + taskId + "\"}"), request);

    verify(tasks).approve(tenantId, taskId, userId, Role.TENANT_ADMIN.name(), null);
    verify(tasks).reject(tenantId, taskId, userId, Role.TENANT_ADMIN.name(), "no");
    verify(tasks).complete(tenantId, taskId);
  }

  @Test
  void completeTaskRejectsAnUnknownDecision() throws Exception {
    JsonNode body = json("{\"taskId\":\"" + UUID.randomUUID() + "\",\"decision\":\"escalate\"}");

    assertThatThrownBy(() -> controller.completeTask(body, request))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Unknown task decision");
  }

  @Test
  void assignTaskPassesTheAssigneeThrough() throws Exception {
    UUID taskId = UUID.randomUUID();
    UUID assigneeId = UUID.randomUUID();
    when(tasks.assign(eq(tenantId), eq(taskId), any(TaskAssignRequest.class))).thenReturn(task());

    Map<String, Object> result =
        controller.assignTask(
            json("{\"taskId\":\"" + taskId + "\",\"assigneeId\":\"" + assigneeId + "\"}"), request);

    assertThat(result).containsKey("status");
    ArgumentCaptor<TaskAssignRequest> captor = ArgumentCaptor.forClass(TaskAssignRequest.class);
    verify(tasks).assign(eq(tenantId), eq(taskId), captor.capture());
    assertThat(captor.getValue().assigneeId()).isEqualTo(assigneeId);
  }

  @Test
  void createApprovalFallsBackToADefaultTitle() throws Exception {
    UUID instanceId = UUID.randomUUID();
    when(tasks.create(eq(tenantId), any(TaskRequest.class))).thenReturn(task());

    controller.createApproval(json("{\"workflowInstanceId\":\"" + instanceId + "\"}"), request);

    ArgumentCaptor<TaskRequest> captor = ArgumentCaptor.forClass(TaskRequest.class);
    verify(tasks).create(eq(tenantId), captor.capture());
    assertThat(captor.getValue().title()).isEqualTo("Copilot approval request");
    assertThat(captor.getValue().workflowInstanceId()).isEqualTo(instanceId);
    assertThat(captor.getValue().assigneeId()).isNull();
  }

  @Test
  void sendNotificationPublishesANormalizedEvent() throws Exception {
    Map<String, Object> result =
        controller.sendNotification(
            json(
                "{\"recipient\":\"user@example.com\",\"channel\":\"sms\",\"templateKey\":\"t\","
                    + "\"locale\":\"tr\",\"variables\":{\"a\":1},\"dedupeKey\":\"d\","
                    + "\"businessKey\":\"b\"}"),
            request);

    assertThat(result).containsEntry("queued", true).containsEntry("channel", "SMS");
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(outbox)
        .publish(
            eq(tenantId),
            eq("NOTIFICATION"),
            any(UUID.class),
            eq("NOTIFICATION_REQUESTED"),
            payload.capture());
    assertThat((Map<String, Object>) payload.getValue())
        .containsEntry("recipient", "user@example.com")
        .containsEntry("templateKey", "t")
        .containsEntry("locale", "tr")
        .containsEntry("dedupeKey", "d")
        .containsEntry("businessKey", "b");
  }

  @Test
  void sendNotificationRejectsABlankRecipientAndAnUnknownChannel() throws Exception {
    JsonNode withoutRecipient = json("{\"channel\":\"EMAIL\"}");
    JsonNode unknownChannel = json("{\"recipient\":\"a@b.c\",\"channel\":\"pigeon\"}");

    assertThatThrownBy(() -> controller.sendNotification(withoutRecipient, request))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("recipient is required");
    assertThatThrownBy(() -> controller.sendNotification(unknownChannel, request))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Unknown notification channel");
    verify(outbox, never()).publish(any(), any(), any(), any(), any());
  }

  @Test
  void searchDocumentsPassesTheTenantAndLimit() throws Exception {
    KnowledgeSearchService.KnowledgeHit hit =
        new KnowledgeSearchService.KnowledgeHit("file-1", "Policy", "PDF", 2, 0, "snippet", 1.5);
    when(knowledge.search(tenantId, "leave", 5)).thenReturn(List.of(hit));

    assertThat(controller.searchDocuments(json("{\"query\":\"leave\",\"limit\":5}"), request))
        .containsExactly(hit);
  }

  @Test
  void indexDocumentDefaultsTitleAndContent() throws Exception {
    UUID fileId = UUID.randomUUID();
    when(knowledge.indexDocument(tenantId, fileId, fileId.toString(), "", "", 1)).thenReturn(2);

    Map<String, Object> result =
        controller.indexDocument(json("{\"fileId\":\"" + fileId + "\"}"), request);

    assertThat(result).containsEntry("fileId", fileId).containsEntry("chunks", 2);
  }

  @Test
  void getUserReturnsTheCallersProfile() {
    User user = mock(User.class);
    when(user.getId()).thenReturn(userId);
    when(user.getTenantId()).thenReturn(tenantId);
    when(user.getEmail()).thenReturn("user@example.com");
    when(user.getFullName()).thenReturn("Ada Lovelace");
    when(user.getRole()).thenReturn(Role.TENANT_ADMIN);
    when(users.findByIdAndTenantId(userId, tenantId)).thenReturn(Optional.of(user));

    assertThat(controller.getUser(null, request))
        .containsEntry("email", "user@example.com")
        .containsEntry("role", "TENANT_ADMIN");
  }

  @Test
  void getUserFailsWithNotFoundWhenTheAccountIsMissing() {
    when(users.findByIdAndTenantId(userId, tenantId)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> controller.getUser(null, request))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(404));
  }

  @Test
  void auditDecisionStoresTheCopilotTrail() throws Exception {
    Map<String, Object> result =
        controller.auditDecision(
            json(
                "{\"action\":\"start_workflow\",\"model\":\"cheap\",\"confidence\":0.82,"
                    + "\"outcome\":\"SUCCESS\"}"),
            request);

    assertThat(result).containsEntry("recorded", true);
    ArgumentCaptor<AutomationAudit> captor = ArgumentCaptor.forClass(AutomationAudit.class);
    verify(audits).save(captor.capture());
    assertThat(captor.getValue().getTenantId()).isEqualTo(tenantId);
    assertThat(captor.getValue().getAction()).isEqualTo("start_workflow");
    assertThat(captor.getValue().getModel()).isEqualTo("cheap");
    assertThat(captor.getValue().getConfidence()).isEqualByComparingTo("0.82");
  }

  private JsonNode json(String value) throws Exception {
    return objectMapper.readTree(value);
  }

  private static WorkflowDefinitionResponse definition(
      String name, String description, String status) {
    return new WorkflowDefinitionResponse(
        UUID.randomUUID(), UUID.randomUUID(), name, description, status, 1);
  }

  private static TaskResponse task() {
    return new TaskResponse(
        UUID.randomUUID(),
        UUID.randomUUID(),
        UUID.randomUUID(),
        "Approve",
        "Please approve",
        UUID.randomUUID(),
        "PENDING",
        0L,
        null);
  }
}

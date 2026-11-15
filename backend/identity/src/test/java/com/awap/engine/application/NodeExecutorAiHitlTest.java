package com.awap.engine.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.ai.application.AiNodeService;
import com.awap.engine.domain.NodeExecution;
import com.awap.engine.domain.NodeExecutionStatus;
import com.awap.engine.domain.WorkflowInstance;
import com.awap.engine.domain.WorkflowState;
import com.awap.engine.infrastructure.NodeExecutionRepository;
import com.awap.identity.domain.Role;
import com.awap.identity.domain.User;
import com.awap.identity.infrastructure.UserRepository;
import com.awap.task.application.TaskService;
import com.awap.task.interfaces.dto.TaskRequest;
import com.awap.workflow.application.WorkflowDefinitionService;
import com.awap.workflow.domain.NodeDefinition;
import com.awap.workflow.domain.NodeType;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** AI_TASK human-in-the-loop handover (confidence below the node threshold). */
class NodeExecutorAiHitlTest {

  private final NodeExecutionRepository nodeExecutionRepository =
      mock(NodeExecutionRepository.class);
  private final WorkflowDefinitionService workflowDefinitionService =
      mock(WorkflowDefinitionService.class);
  private final TaskService taskService = mock(TaskService.class);
  private final UserRepository userRepository = mock(UserRepository.class);
  private final WorkflowEnginePort port = mock(WorkflowEnginePort.class);
  private final OutboxEventPublisher outbox = mock(OutboxEventPublisher.class);
  private final AiNodeService aiNodeService = mock(AiNodeService.class);

  private final UUID tenantId = UUID.randomUUID();

  private NodeExecutor executor;

  @BeforeEach
  void setUp() {
    executor =
        new NodeExecutor(
            nodeExecutionRepository,
            workflowDefinitionService,
            new NodeConfigReader(new ObjectMapper().findAndRegisterModules()),
            taskService,
            userRepository,
            port,
            null,
            null,
            null,
            aiNodeService,
            null,
            outbox);
  }

  @Test
  void lowConfidenceAiTaskCreatesOneApprovalTaskAndWaitsForTheHuman() {
    WorkflowInstance instance =
        new WorkflowInstance(tenantId, UUID.randomUUID(), 1, WorkflowState.RUNNING, null, "{}");
    NodeDefinition node =
        new NodeDefinition(
            tenantId,
            UUID.randomUUID(),
            "ai-1",
            NodeType.AI_TASK,
            "AI classification",
            "{\"action\":\"CLASSIFY\",\"prompt\":\"classify the request\","
                + "\"approvers\":[\"role:TENANT_ADMIN\"]}",
            0);
    NodeExecution execution =
        new NodeExecution(tenantId, instance.getId(), "ai-1", NodeType.AI_TASK.name());
    when(nodeExecutionRepository.findByWorkflowInstanceIdAndNodeId(instance.getId(), "ai-1"))
        .thenReturn(Optional.of(execution));
    when(nodeExecutionRepository.save(any(NodeExecution.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));
    User approver =
        new User(tenantId, "approver@example.com", "hash", "Ada Lovelace", Role.TENANT_ADMIN);
    when(userRepository.findFirstByTenantIdAndRole(tenantId, Role.TENANT_ADMIN))
        .thenReturn(Optional.of(approver));
    when(aiNodeService.evaluate(
            eq(tenantId),
            eq(instance.getId()),
            eq("ai-1"),
            eq(AiNodeService.AiAction.CLASSIFY),
            eq("classify the request"),
            isNull()))
        .thenReturn(new AiNodeService.AiNodeResult("maybe finance", 0.35, true, false));

    executor.executeNode(instance, node);

    ArgumentCaptor<TaskRequest> captor = ArgumentCaptor.forClass(TaskRequest.class);
    verify(taskService).createIfAbsentForNode(eq(tenantId), captor.capture());
    TaskRequest request = captor.getValue();
    assertThat(request.title()).isEqualTo("AI approval required: AI classification");
    assertThat(request.description())
        .contains("ai-1")
        .contains("0.35")
        .contains("below the configured threshold");
    assertThat(request.workflowInstanceId()).isEqualTo(instance.getId());
    assertThat(request.nodeExecutionId()).isEqualTo(execution.getId());
    assertThat(request.assigneeId()).isEqualTo(approver.getId());
    assertThat(execution.getStatus()).isEqualTo(NodeExecutionStatus.WAITING);
    assertThat(instance.getState()).isEqualTo(WorkflowState.WAITING);
    verify(port).log(instance, "ai-1", NodeType.AI_TASK.name(), "AI_HITL_REQUIRED", null);
  }

  @Test
  void extractNodesForwardTheSchemaToTheAiService() {
    WorkflowInstance instance =
        new WorkflowInstance(tenantId, UUID.randomUUID(), 1, WorkflowState.RUNNING, null, "{}");
    String schema = "{\"required\":[\"vendor\"],\"properties\":{\"vendor\":{\"type\":\"string\"}}}";
    NodeDefinition node =
        new NodeDefinition(
            tenantId,
            UUID.randomUUID(),
            "extract-1",
            NodeType.AI_TASK,
            "Extract invoice",
            "{\"action\":\"EXTRACT\",\"prompt\":\"extract\",\"schema\":" + schema + "}",
            0);
    NodeExecution execution =
        new NodeExecution(tenantId, instance.getId(), "extract-1", NodeType.AI_TASK.name());
    when(nodeExecutionRepository.findByWorkflowInstanceIdAndNodeId(instance.getId(), "extract-1"))
        .thenReturn(Optional.of(execution));
    when(nodeExecutionRepository.save(any(NodeExecution.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));
    when(aiNodeService.evaluate(
            eq(tenantId),
            eq(instance.getId()),
            eq("extract-1"),
            eq(AiNodeService.AiAction.EXTRACT),
            eq("extract"),
            eq(schema)))
        .thenReturn(new AiNodeService.AiNodeResult("{\"vendor\":\"Acme\"}", 0.95, false, false));

    executor.executeNode(instance, node);

    verify(aiNodeService)
        .evaluate(
            eq(tenantId),
            eq(instance.getId()),
            eq("extract-1"),
            eq(AiNodeService.AiAction.EXTRACT),
            eq("extract"),
            eq(schema));
  }
}

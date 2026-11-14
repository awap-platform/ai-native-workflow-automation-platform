package com.awap.ai.interfaces.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.ai.infrastructure.AiCopilotClient;
import com.awap.common.api.AwapException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;

/** The SPA-facing proxy must forward to the AI layer without reshaping the payload. */
class CopilotControllerTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final AiCopilotClient client = mock(AiCopilotClient.class);
  private final JsonNode response = objectMapper.createObjectNode().put("answer", "ok");

  private CopilotController controller;

  @BeforeEach
  @SuppressWarnings("unchecked")
  void setUp() {
    ObjectProvider<AiCopilotClient> provider = mock(ObjectProvider.class);
    // A fresh stream per call: a Stream can only be consumed once and the controller calls
    // stream().findFirst() on every request.
    when(provider.stream()).thenAnswer(invocation -> Stream.of(client));
    controller = new CopilotController(provider, objectMapper);
    when(client.forward(anyString(), any())).thenReturn(response);
    when(client.forward(anyString(), any(), any())).thenReturn(response);
  }

  @Test
  void chatForwardsTheBody() throws Exception {
    assertThat(controller.chat("{\"message\":\"start leave\"}", null).getBody())
        .isEqualTo(response);
    verify(client)
        .forward(
            "/api/v1/copilot/chat", objectMapper.readTree("{\"message\":\"start leave\"}"), null);
  }

  @Test
  void chatForwardsTheIdempotencyKeyAndAddsItToTheBody() {
    controller.chat("{\"message\":\"start leave\"}", "intent-1");

    ArgumentCaptor<JsonNode> forwardedBody = ArgumentCaptor.forClass(JsonNode.class);
    verify(client).forward(anyString(), forwardedBody.capture(), any());
    verify(client).forward("/api/v1/copilot/chat", forwardedBody.getValue(), "intent-1");
    assertThat(forwardedBody.getValue().path("idempotency_key").asText()).isEqualTo("intent-1");
  }

  @Test
  void chatDoesNotRewriteAnExistingBodyKey() {
    controller.chat("{\"message\":\"start leave\",\"idempotency_key\":\"body-key\"}", "header-key");

    ArgumentCaptor<JsonNode> forwardedBody = ArgumentCaptor.forClass(JsonNode.class);
    verify(client).forward(anyString(), forwardedBody.capture(), any());
    assertThat(forwardedBody.getValue().path("idempotency_key").asText()).isEqualTo("body-key");
  }

  @Test
  void chatRejectsABlankBodyWith400() {
    assertThatThrownBy(() -> controller.chat("", null))
        .isInstanceOf(AwapException.class)
        .satisfies(
            ex ->
                assertThat(((AwapException) ex).status())
                    .isEqualTo(org.springframework.http.HttpStatus.BAD_REQUEST));
  }

  @Test
  void chatRejectsAMalformedBodyWith400() {
    assertThatThrownBy(() -> controller.chat("{not-json", null))
        .isInstanceOf(AwapException.class)
        .satisfies(
            ex ->
                assertThat(((AwapException) ex).status())
                    .isEqualTo(org.springframework.http.HttpStatus.BAD_REQUEST));
  }

  @Test
  void tasksAndPromptsUseGetSemantics() {
    assertThat(controller.tasks().getBody()).isEqualTo(response);
    assertThat(controller.prompts().getBody()).isEqualTo(response);
    assertThat(controller.metrics().getBody()).isEqualTo(response);
    verify(client).forward("/api/v1/copilot/tasks", null);
    verify(client).forward("/api/v1/copilot/prompts", null);
    verify(client).forward("/api/v1/copilot/metrics", null);
  }

  @Test
  void completeTaskBuildsTheTaskScopedPath() throws Exception {
    assertThat(controller.completeTask("task-9", "{\"decision\":\"approve\"}", null).getBody())
        .isEqualTo(response);
    verify(client)
        .forward(
            "/api/v1/copilot/tasks/task-9/complete",
            objectMapper.readTree("{\"decision\":\"approve\"}"),
            null);
  }

  @Test
  void completeTaskForwardsTheIdempotencyKey() {
    controller.completeTask("task-9", "{\"decision\":\"approve\"}", "task-key");

    ArgumentCaptor<JsonNode> forwarded = ArgumentCaptor.forClass(JsonNode.class);
    verify(client).forward(anyString(), forwarded.capture(), any());
    assertThat(forwarded.getValue().path("idempotency_key").asText()).isEqualTo("task-key");
    verify(client)
        .forward("/api/v1/copilot/tasks/task-9/complete", forwarded.getValue(), "task-key");
  }

  @Test
  void approvalAssistanceAndKnowledgeSearchForwardTheirBodies() throws Exception {
    assertThat(controller.approvalAssistance("{\"workflowInstanceId\":\"i-1\"}", null).getBody())
        .isEqualTo(response);
    assertThat(controller.knowledgeSearch("{\"query\":\"leave policy\"}").getBody())
        .isEqualTo(response);
    verify(client)
        .forward(
            "/api/v1/copilot/approvals",
            objectMapper.readTree("{\"workflowInstanceId\":\"i-1\"}"),
            null);
    verify(client)
        .forward(
            "/api/v1/copilot/knowledge/search",
            objectMapper.readTree("{\"query\":\"leave policy\"}"));
  }

  @Test
  void withIdempotencyKeyLeavesNonObjectBodiesUntouched() {
    JsonNode array = objectMapper.createArrayNode();

    assertThat(CopilotController.withIdempotencyKey(array, "key")).isSameAs(array);
    assertThat(CopilotController.withIdempotencyKey(null, "key")).isNull();
  }

  @Test
  void withIdempotencyKeyIgnoresABlankHeader() throws Exception {
    JsonNode body = objectMapper.readTree("{\"message\":\"start\"}");

    assertThat(CopilotController.withIdempotencyKey(body, "  ")).isSameAs(body);
  }

  @Test
  @SuppressWarnings("unchecked")
  void reportsNotImplementedWhenCopilotIsDisabled() {
    ObjectProvider<AiCopilotClient> empty = mock(ObjectProvider.class);
    when(empty.stream()).thenReturn(Stream.empty());
    CopilotController disabled = new CopilotController(empty, objectMapper);

    assertThatThrownBy(disabled::tasks)
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("not enabled")
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(501));
  }
}

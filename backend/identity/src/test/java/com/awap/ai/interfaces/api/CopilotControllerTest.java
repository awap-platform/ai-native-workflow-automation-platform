package com.awap.ai.interfaces.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

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
    controller = new CopilotController(provider);
    when(client.forward(anyString(), any())).thenReturn(response);
    when(client.forward(anyString(), any(), any())).thenReturn(response);
  }

  @Test
  void chatForwardsTheBody() throws Exception {
    JsonNode body = objectMapper.readTree("{\"message\":\"start leave\"}");

    assertThat(controller.chat(body, null).getBody()).isEqualTo(response);
    verify(client).forward("/api/v1/copilot/chat", body, null);
  }

  @Test
  void chatForwardsTheIdempotencyKeyAndAddsItToTheBody() throws Exception {
    JsonNode body = objectMapper.readTree("{\"message\":\"start leave\"}");

    controller.chat(body, "intent-1");

    ArgumentCaptor<JsonNode> forwardedBody = ArgumentCaptor.forClass(JsonNode.class);
    verify(client).forward(anyString(), forwardedBody.capture(), any());
    verify(client).forward("/api/v1/copilot/chat", forwardedBody.getValue(), "intent-1");
    assertThat(forwardedBody.getValue().path("idempotency_key").asText()).isEqualTo("intent-1");
  }

  @Test
  void chatDoesNotRewriteAnExistingBodyKey() throws Exception {
    JsonNode body =
        objectMapper.readTree("{\"message\":\"start leave\",\"idempotency_key\":\"body-key\"}");

    controller.chat(body, "header-key");

    ArgumentCaptor<JsonNode> forwardedBody = ArgumentCaptor.forClass(JsonNode.class);
    verify(client).forward(anyString(), forwardedBody.capture(), any());
    assertThat(forwardedBody.getValue().path("idempotency_key").asText()).isEqualTo("body-key");
  }

  @Test
  void submitJobReturnsAcceptedAndForwardsTheBody() throws Exception {
    JsonNode body = objectMapper.readTree("{\"message\":\"summarise\"}");

    ResponseEntity<JsonNode> result = controller.submitJob(body, null);

    assertThat(result.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
    assertThat(result.getBody()).isEqualTo(response);
    verify(client).forward("/api/v1/copilot/jobs", body, null);
  }

  @Test
  void submitJobForwardsTheIdempotencyKey() throws Exception {
    JsonNode body = objectMapper.readTree("{\"message\":\"summarise\"}");

    controller.submitJob(body, "job-key");

    ArgumentCaptor<JsonNode> forwarded = ArgumentCaptor.forClass(JsonNode.class);
    verify(client).forward(anyString(), forwarded.capture(), any());
    assertThat(forwarded.getValue().path("idempotency_key").asText()).isEqualTo("job-key");
    verify(client).forward("/api/v1/copilot/jobs", forwarded.getValue(), "job-key");
  }

  @Test
  void jobStatusAndCancelUseTheJobPaths() {
    assertThat(controller.jobStatus("job-1").getBody()).isEqualTo(response);
    assertThat(controller.cancelJob("job-1").getBody()).isEqualTo(response);
    verify(client).forward("/api/v1/copilot/jobs/job-1", null);
    verify(client).forward(eq("/api/v1/copilot/jobs/job-1/cancel"), any());
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
    JsonNode body = objectMapper.readTree("{\"decision\":\"approve\"}");

    assertThat(controller.completeTask("task-9", body, null).getBody()).isEqualTo(response);
    verify(client).forward("/api/v1/copilot/tasks/task-9/complete", body, null);
  }

  @Test
  void completeTaskForwardsTheIdempotencyKey() throws Exception {
    JsonNode body = objectMapper.readTree("{\"decision\":\"approve\"}");

    controller.completeTask("task-9", body, "task-key");

    ArgumentCaptor<JsonNode> forwarded = ArgumentCaptor.forClass(JsonNode.class);
    verify(client).forward(anyString(), forwarded.capture(), any());
    assertThat(forwarded.getValue().path("idempotency_key").asText()).isEqualTo("task-key");
    verify(client)
        .forward("/api/v1/copilot/tasks/task-9/complete", forwarded.getValue(), "task-key");
  }

  @Test
  void approvalAssistanceAndKnowledgeSearchForwardTheirBodies() throws Exception {
    JsonNode approval = objectMapper.readTree("{\"workflowInstanceId\":\"i-1\"}");
    JsonNode query = objectMapper.readTree("{\"query\":\"leave policy\"}");

    assertThat(controller.approvalAssistance(approval, null).getBody()).isEqualTo(response);
    assertThat(controller.knowledgeSearch(query).getBody()).isEqualTo(response);
    verify(client).forward("/api/v1/copilot/approvals", approval, null);
    verify(client).forward("/api/v1/copilot/knowledge/search", query);
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
    CopilotController disabled = new CopilotController(empty);

    assertThatThrownBy(disabled::tasks)
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("not enabled")
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(501));
  }

  @Test
  void chatStreamRelaysTheUpstreamFramesAndDisablesBuffering() throws Exception {
    byte[] frames =
        "data: {\"v\":1,\"type\":\"token\",\"seq\":1,\"delta\":\"hi\"}\n\n"
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    @SuppressWarnings("unchecked")
    java.net.http.HttpResponse<java.io.InputStream> upstream =
        mock(java.net.http.HttpResponse.class);
    when(upstream.body()).thenReturn(new java.io.ByteArrayInputStream(frames));
    when(client.stream(eq("/api/v1/copilot/chat/stream"), any(), eq("intent-1")))
        .thenReturn(upstream);
    JsonNode body = objectMapper.readTree("{\"message\":\"hi\"}");

    ResponseEntity<org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody>
        response = controller.chatStream(body, "intent-1");

    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    response.getBody().writeTo(out);

    assertThat(response.getHeaders().getContentType())
        .isEqualTo(org.springframework.http.MediaType.TEXT_EVENT_STREAM);
    assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-cache");
    assertThat(response.getHeaders().getFirst("X-Accel-Buffering")).isEqualTo("no");
    assertThat(out.toString(java.nio.charset.StandardCharsets.UTF_8))
        .contains("\"type\":\"token\"");
    verify(client).stream(eq("/api/v1/copilot/chat/stream"), any(), eq("intent-1"));
  }
}

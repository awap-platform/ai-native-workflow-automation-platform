package com.awap.ai.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

import com.awap.common.api.AwapException;
import com.awap.common.correlation.CorrelationId;
import com.awap.identity.infrastructure.security.TenantContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;

/** Transport contract between the backend and the AI layer Copilot service. */
class AiCopilotClientTest {

  private final HttpClient httpClient = mock(HttpClient.class);
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final UUID tenantId = UUID.randomUUID();
  private final UUID userId = UUID.randomUUID();

  private AiCopilotClient client() {
    return new AiCopilotClient(
        httpClient, objectMapper, "http://ai.local/", "service-secret", Duration.ofSeconds(2));
  }

  @AfterEach
  void clearThreadLocals() {
    TenantContext.clear();
    CorrelationId.clear();
  }

  @Test
  void theAutowiredConstructorClampsTheTimeoutToASafeMinimum() {
    AiCopilotClient real = new AiCopilotClient("http://ai.local/", "token", 0L, objectMapper);

    assertThat(real).isNotNull();
  }

  @Test
  void requiresAnAuthenticatedTenantContext() {
    assertThatThrownBy(
            () -> client().forward("/api/v1/copilot/chat", objectMapper.createObjectNode()))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(401));
  }

  @Test
  void rejectsAnUnknownCallerRole() {
    TenantContext.set(tenantId, userId, "GHOST");

    assertThatThrownBy(
            () -> client().forward("/api/v1/copilot/chat", objectMapper.createObjectNode()))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(403));
  }

  @Test
  void forwardsTheSecurityContextTenantAndCorrelationHeaders() throws Exception {
    TenantContext.set(tenantId, userId, "TENANT_ADMIN");
    CorrelationId.set("corr-42");
    respond(200, "{\"answer\":\"done\"}");

    JsonNode result = client().forward("/api/v1/copilot/chat", objectMapper.createObjectNode());

    assertThat(result.path("answer").asText()).isEqualTo("done");
    HttpRequest sent = capturedRequest();
    assertThat(sent.method()).isEqualTo("POST");
    assertThat(sent.uri().toString()).isEqualTo("http://ai.local/api/v1/copilot/chat");
    assertThat(header(sent, "X-Tenant-Id")).isEqualTo(tenantId.toString());
    assertThat(header(sent, "X-User-Id")).isEqualTo(userId.toString());
    assertThat(header(sent, "X-User-Role")).isEqualTo("TENANT_ADMIN");
    assertThat(header(sent, "X-User-Permissions")).contains("INSTANCE_MANAGE");
    assertThat(header(sent, "X-Ai-Service-Token")).isEqualTo("service-secret");
    assertThat(header(sent, CorrelationId.HEADER)).isEqualTo("corr-42");
    assertThat(sent.bodyPublisher()).isPresent();
  }

  @Test
  void usesGetWhenNoBodyIsProvided() throws Exception {
    TenantContext.set(tenantId, userId, "EMPLOYEE");
    respond(200, "{\"prompts\":[]}");

    client().forward("/api/v1/copilot/prompts", null);

    assertThat(capturedRequest().method()).isEqualTo("GET");
  }

  @Test
  void returnsAnEmptyObjectForABlankSuccessBody() throws Exception {
    TenantContext.set(tenantId, userId, "EMPLOYEE");
    respond(204, "");

    JsonNode result = client().forward("/api/v1/copilot/metrics", null);

    assertThat(result.isObject()).isTrue();
    assertThat(result.isEmpty()).isTrue();
  }

  @ParameterizedTest
  @CsvSource({"401,401", "403,403", "429,429", "418,400", "500,502", "503,502"})
  void mapsUpstreamStatusesToBackendErrors(int upstream, int expected) throws Exception {
    TenantContext.set(tenantId, userId, "EMPLOYEE");
    respond(upstream, "{}");

    assertThatThrownBy(
            () -> client().forward("/api/v1/copilot/chat", objectMapper.createObjectNode()))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("status " + upstream)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(expected));
  }

  @Test
  void mapsTransportFailuresToBadGateway() throws Exception {
    TenantContext.set(tenantId, userId, "EMPLOYEE");
    failWith(new IOException("connection refused"));

    assertThatThrownBy(
            () -> client().forward("/api/v1/copilot/chat", objectMapper.createObjectNode()))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("unreachable")
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(502));
  }

  @Test
  void restoresTheInterruptFlagWhenTheCallIsInterrupted() throws Exception {
    TenantContext.set(tenantId, userId, "EMPLOYEE");
    failWith(new InterruptedException("stop"));

    try {
      assertThatThrownBy(
              () -> client().forward("/api/v1/copilot/chat", objectMapper.createObjectNode()))
          .isInstanceOf(AwapException.class)
          .hasMessageContaining("interrupted")
          .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(502));
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  private void respond(int status, String body) throws Exception {
    HttpResponse<String> response = mock(HttpResponse.class);
    doReturn(status).when(response).statusCode();
    doReturn(body).when(response).body();
    doReturn(response).when(httpClient).send(any(), any());
  }

  @SuppressWarnings("rawtypes")
  private void failWith(Exception failure) throws Exception {
    doThrow(failure).when(httpClient).send(any(), any());
  }

  @SuppressWarnings("rawtypes")
  private HttpRequest capturedRequest() throws Exception {
    ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
    org.mockito.Mockito.verify(httpClient).send(captor.capture(), any());
    return captor.getValue();
  }

  private static String header(HttpRequest request, String name) {
    return request.headers().firstValue(name).orElse(null);
  }
}

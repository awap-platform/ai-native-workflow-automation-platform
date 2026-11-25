package com.awap.ai.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.identity.infrastructure.security.TenantContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The streaming transport opens upstream bodies, maps failures and never leaks a stream. */
class AiCopilotClientStreamTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final HttpClient httpClient = mock(HttpClient.class);
  private AiCopilotClient client;

  @BeforeEach
  void setUp() {
    client =
        new AiCopilotClient(
            httpClient, objectMapper, "http://ai-layer", "token", Duration.ofSeconds(2));
    TenantContext.set(
        UUID.fromString("11111111-1111-1111-1111-111111111111"),
        UUID.fromString("22222222-2222-2222-2222-222222222222"),
        "MANAGER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @SuppressWarnings("unchecked")
  private HttpResponse<InputStream> response(int status, InputStream body) {
    HttpResponse<InputStream> response = mock(HttpResponse.class);
    when(response.statusCode()).thenReturn(status);
    when(response.body()).thenReturn(body);
    return response;
  }

  @Test
  void streamReturnsTheUpstreamBody() throws Exception {
    HttpResponse<InputStream> streamed =
        response(200, new ByteArrayInputStream("data: {}\n\n".getBytes()));
    when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenReturn(streamed);

    HttpResponse<InputStream> upstream =
        client.stream(
            "/api/v1/copilot/chat/stream", objectMapper.readTree("{\"message\":\"hi\"}"), "key-1");

    assertThat(upstream.statusCode()).isEqualTo(200);
    assertThat(new String(upstream.body().readAllBytes())).contains("data:");
  }

  @Test
  void streamMapsANonSuccessStatusToABadGateway() throws Exception {
    HttpResponse<InputStream> failed = response(500, new ByteArrayInputStream(new byte[0]));
    when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenReturn(failed);

    assertThatThrownBy(
            () ->
                client.stream(
                    "/api/v1/copilot/chat/stream",
                    objectMapper.readTree("{\"message\":\"hi\"}"),
                    null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("could not be opened");
  }

  @Test
  void streamMapsAnIoFailureToAGatewayTimeout() throws Exception {
    when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenThrow(new IOException("connect timed out"));

    assertThatThrownBy(
            () ->
                client.stream(
                    "/api/v1/copilot/chat/stream",
                    objectMapper.readTree("{\"message\":\"hi\"}"),
                    null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("did not start in time");
  }

  @Test
  void streamMapsAnInterruptAndRestoresTheFlag() throws Exception {
    when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenThrow(new InterruptedException("interrupted"));

    assertThatThrownBy(
            () ->
                client.stream(
                    "/api/v1/copilot/chat/stream",
                    objectMapper.readTree("{\"message\":\"hi\"}"),
                    null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("interrupted");
    assertThat(Thread.currentThread().isInterrupted()).isTrue();
    Thread.interrupted();
  }

  @Test
  void streamRequiresAnAuthenticatedContext() throws Exception {
    TenantContext.clear();

    assertThatThrownBy(
            () ->
                client.stream(
                    "/api/v1/copilot/chat/stream",
                    objectMapper.readTree("{\"message\":\"hi\"}"),
                    null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Authentication is required");
  }
}

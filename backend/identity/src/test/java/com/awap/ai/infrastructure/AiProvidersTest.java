package com.awap.ai.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.ai.application.AiCapability;
import com.awap.ai.application.AiProvider;
import com.awap.ai.application.AiProviderException;
import com.awap.ai.application.AiProviderRequest;
import com.awap.ai.application.LocalHeuristicAiBackend;
import com.awap.ai.domain.AiModelRouter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Provider adapters normalize vendor wire formats and errors (issue #292). */
class AiProvidersTest {

  private final ObjectMapper mapper = new ObjectMapper();
  private final AtomicReference<String> path = new AtomicReference<>();
  private final AtomicReference<String> authorization = new AtomicReference<>();
  private final AtomicReference<String> apiKey = new AtomicReference<>();
  private final AtomicReference<String> version = new AtomicReference<>();
  private final AtomicReference<String> body = new AtomicReference<>();

  private HttpServer server;
  private String baseUrl;

  @BeforeEach
  void startServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.start();
    baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @AfterEach
  void stopServer() {
    server.stop(0);
  }

  private void respond(int status, String responseBody) {
    respond(
        status,
        responseBody,
        exchange -> {
          path.set(exchange.getRequestURI().getPath());
          authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
          apiKey.set(exchange.getRequestHeaders().getFirst("x-api-key"));
          version.set(exchange.getRequestHeaders().getFirst("anthropic-version"));
          try {
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          } catch (IOException ex) {
            throw new IllegalStateException(ex);
          }
        });
  }

  private void respond(int status, String responseBody, Consumer<HttpExchange> capture) {
    server.createContext(
        "/",
        exchange -> {
          capture.accept(exchange);
          byte[] payload = responseBody.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/json");
          exchange.sendResponseHeaders(status, payload.length);
          exchange.getResponseBody().write(payload);
          exchange.close();
        });
  }

  private OpenAiProvider openAi() {
    return new OpenAiProvider(
        HttpClient.newHttpClient(), mapper, baseUrl + "/", "sk-test", "test-model", 2, 2_000);
  }

  private AnthropicProvider anthropic() {
    return new AnthropicProvider(
        HttpClient.newHttpClient(), mapper, baseUrl, "anthropic-key", "claude-test", 1, 2_000);
  }

  private static AiProviderRequest request(String prompt, String model) {
    return new AiProviderRequest(prompt, 16, model, AiCapability.CLASSIFICATION);
  }

  @Test
  void openAiReturnsContentAndSendsTheVendorPayload() {
    respond(200, "{\"choices\":[{\"message\":{\"content\":\"FINISH\"}}]}");
    OpenAiProvider provider = openAi();

    assertThat(provider.complete(request("classify: invoice", null))).isEqualTo("FINISH");
    assertThat(path.get()).isEqualTo("/chat/completions");
    assertThat(authorization.get()).isEqualTo("Bearer sk-test");
    assertThat(body.get())
        .contains("\"model\":\"test-model\"")
        .contains("\"max_tokens\":16")
        .contains("classify: invoice");

    assertThat(provider.id()).isEqualTo("openai");
    assertThat(provider.healthy()).isTrue();
    assertThat(provider.models()).hasSize(1);
    assertThat(provider.models().get(0).tier()).isEqualTo(AiModelRouter.Tier.STANDARD);
    assertThat(provider.models().get(0).capabilities()).contains(AiCapability.EXTRACTION);
  }

  @Test
  void openAiHonoursAnExplicitModelOverride() {
    respond(200, "{\"choices\":[{\"message\":{\"content\":\"OK\"}}]}");

    openAi().complete(request("classify: invoice", "override-model"));

    assertThat(body.get()).contains("\"model\":\"override-model\"");
  }

  @Test
  void vendorStatusesMapToNeutralErrors() {
    respond(429, "{}");
    assertThat(codeOf(() -> openAi().complete(request("classify: x", null))))
        .isEqualTo(AiProviderException.Code.RATE_LIMITED);

    respondWithReset(503);
    assertThat(codeOf(() -> openAi().complete(request("classify: x", null))))
        .isEqualTo(AiProviderException.Code.UNAVAILABLE);

    respondWithReset(401);
    assertThat(codeOf(() -> openAi().complete(request("classify: x", null))))
        .isEqualTo(AiProviderException.Code.AUTHENTICATION);

    respondWithReset(418);
    assertThat(codeOf(() -> openAi().complete(request("classify: x", null))))
        .isEqualTo(AiProviderException.Code.INVALID_REQUEST);
  }

  @Test
  void malformedAndEmptyAnswersMapToNeutralErrors() {
    respond(200, "{");
    assertThat(codeOf(() -> openAi().complete(request("classify: x", null))))
        .isEqualTo(AiProviderException.Code.MALFORMED_RESPONSE);

    respondWithReset(200);
    assertThat(codeOf(() -> openAi().complete(request("classify: x", null))))
        .isEqualTo(AiProviderException.Code.EMPTY_CONTENT);
  }

  @Test
  void transportFailuresMapToNeutralErrors() throws Exception {
    AiProvider io = providerFailingWith(new IOException("socket"));
    AiProvider timeout = providerFailingWith(new HttpTimeoutException("slow"));
    AiProvider interrupted = providerFailingWith(new InterruptedException("stop"));

    assertThat(codeOf(() -> io.complete(request("x", null))))
        .isEqualTo(AiProviderException.Code.UNAVAILABLE);
    assertThat(codeOf(() -> timeout.complete(request("x", null))))
        .isEqualTo(AiProviderException.Code.TIMEOUT);
    try {
      assertThat(codeOf(() -> interrupted.complete(request("x", null))))
          .isEqualTo(AiProviderException.Code.UNAVAILABLE);
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void theSpringConstructorsBuildHttpClients() {
    assertThat(new OpenAiProvider(baseUrl, "sk-test", "m", 1, 1000, mapper)).isNotNull();
    assertThat(new AnthropicProvider(baseUrl, "key", "m", 1, 1000, mapper)).isNotNull();
  }

  @Test
  void aMissingKeyOrBaseUrlFailsFastWithoutLeakingTheSecret() {
    assertThatThrownBy(
            () -> new OpenAiProvider(HttpClient.newHttpClient(), mapper, baseUrl, "", "m", 1, 1000))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageNotContaining("secret");
    assertThatThrownBy(
            () ->
                new OpenAiProvider(
                    HttpClient.newHttpClient(), mapper, " ", "super-secret", "m", 1, 1000))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("base URL")
        .hasMessageNotContaining("super-secret");
  }

  @Test
  void anthropicUsesItsOwnHeadersAndContentShape() {
    respond(200, "{\"content\":[{\"text\":\"CLAUDE\"}]}");
    AnthropicProvider provider = anthropic();

    assertThat(provider.complete(request("classify: contract", null))).isEqualTo("CLAUDE");
    assertThat(path.get()).isEqualTo("/v1/messages");
    assertThat(apiKey.get()).isEqualTo("anthropic-key");
    assertThat(version.get()).isEqualTo("2023-06-01");
    assertThat(body.get()).contains("\"model\":\"claude-test\"").contains("classify: contract");
    assertThat(provider.id()).isEqualTo("anthropic");
    assertThat(provider.models().get(0).costMicrosPerToken()).isEqualTo(1);
  }

  @Test
  void anthropicErrorsAreNormalizedToo() {
    respond(429, "{}");

    assertThat(codeOf(() -> anthropic().complete(request("classify: x", null))))
        .isEqualTo(AiProviderException.Code.RATE_LIMITED);
  }

  @Test
  void theLocalProviderIsDeterministicAndFree() {
    LocalHeuristicProvider provider = new LocalHeuristicProvider(new LocalHeuristicAiBackend());

    assertThat(provider.complete(request("summarize: hello", null))).isEqualTo("hello");
    assertThat(provider.id()).isEqualTo("local");
    assertThat(provider.healthy()).isTrue();
    assertThat(provider.models().get(0).costMicrosPerToken()).isZero();
    assertThat(codeOf(() -> provider.complete(request("unknown: payload", null))))
        .isEqualTo(AiProviderException.Code.EMPTY_CONTENT);
  }

  private void respondWithReset(int status) {
    stopServer();
    try {
      startServer();
      respond(status, "{}");
    } catch (IOException ex) {
      throw new IllegalStateException(ex);
    }
  }

  private static AiProviderException.Code codeOf(Runnable action) {
    try {
      action.run();
      throw new AssertionError("expected an AiProviderException");
    } catch (AiProviderException ex) {
      return ex.code();
    }
  }

  @SuppressWarnings("unchecked")
  private AiProvider providerFailingWith(Exception failure) throws Exception {
    HttpClient client = mock(HttpClient.class);
    when(client.send(any(), any())).thenThrow(failure);
    return new OpenAiProvider(
        client, mapper, "http://localhost/v1", "key", "m", 1, Duration.ofSeconds(1).toMillis());
  }
}

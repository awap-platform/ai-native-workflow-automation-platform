package com.awap.common.knowledge;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Minimal OpenSearch HTTP client owned by the shared kernel. It deliberately has no dependency on
 * the analytics/document modules, so knowledge search does not participate in a module cycle.
 */
@Component
public class KnowledgeOpenSearchClient {

  private final HttpClient httpClient;
  private final String endpoint;
  private final Duration requestTimeout;

  @Autowired
  public KnowledgeOpenSearchClient(
      @Value("${awap.knowledge.opensearch.endpoint:http://localhost:9200}") String endpoint,
      @Value("${awap.knowledge.opensearch.connect-timeout-ms:2000}") long connectTimeoutMs,
      @Value("${awap.knowledge.opensearch.request-timeout-ms:3000}") long requestTimeoutMs) {
    this(
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(Math.max(1, connectTimeoutMs)))
            .build(),
        endpoint,
        Duration.ofMillis(Math.max(1, requestTimeoutMs)));
  }

  /** Visible for tests so a local server/fake can stand in for OpenSearch. */
  public KnowledgeOpenSearchClient(
      HttpClient httpClient, String endpoint, Duration requestTimeout) {
    this.httpClient = httpClient;
    this.endpoint =
        endpoint.endsWith("/") ? endpoint.substring(0, endpoint.length() - 1) : endpoint;
    this.requestTimeout = requestTimeout;
  }

  public Response post(String path, String body) throws IOException, InterruptedException {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create(endpoint + path)).timeout(requestTimeout);
    if (body == null) {
      builder.method("POST", HttpRequest.BodyPublishers.noBody());
    } else {
      builder.header("Content-Type", "application/json");
      builder.method("POST", HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
    }
    HttpResponse<String> response =
        httpClient.send(
            builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    return new Response(response.statusCode(), response.body());
  }

  /** OpenSearch response status and body. */
  public record Response(int status, String body) {}
}

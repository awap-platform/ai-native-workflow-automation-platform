package com.awap.ai.infrastructure;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.common.correlation.CorrelationId;
import com.awap.identity.domain.Role;
import com.awap.identity.infrastructure.security.TenantContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Backend-to-AI-layer Copilot transport. The public SPA never talks to the Python service directly;
 * this client forwards the authenticated tenant/user/role context and the correlation ID.
 */
@Component
@ConditionalOnProperty(name = "awap.ai.copilot.enabled", havingValue = "true")
public class AiCopilotClient {

  private final HttpClient httpClient;
  private final ObjectMapper objectMapper;
  private final String baseUrl;
  private final String serviceToken;
  private final Duration timeout;

  @Autowired
  public AiCopilotClient(
      @Value("${awap.ai.layer.base-url:http://localhost:8000}") String baseUrl,
      @Value("${awap.ai.internal-token:}") String serviceToken,
      @Value("${awap.ai.copilot.timeout-ms:10000}") long timeoutMs,
      ObjectMapper objectMapper) {
    this(
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(Math.min(Math.max(timeoutMs, 1), 2_000)))
            .build(),
        objectMapper,
        baseUrl,
        serviceToken,
        Duration.ofMillis(Math.max(timeoutMs, 1)));
  }

  public AiCopilotClient(
      HttpClient httpClient,
      ObjectMapper objectMapper,
      String baseUrl,
      String serviceToken,
      Duration timeout) {
    this.httpClient = httpClient;
    this.objectMapper = objectMapper;
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    this.serviceToken = serviceToken;
    this.timeout = timeout;
  }

  public JsonNode forward(String path, JsonNode body) {
    return forward(path, body, null);
  }

  public JsonNode forward(String path, JsonNode body, String idempotencyKey) {
    TenantContext.Context context =
        TenantContext.current()
            .orElseThrow(
                () ->
                    new AwapException(
                        ErrorCode.UNAUTHORIZED,
                        HttpStatus.UNAUTHORIZED,
                        "Authentication is required."));
    Role role = parseRole(context.role());
    String permissions =
        role.permissions().stream().map(Enum::name).sorted().collect(Collectors.joining(","));
    try {
      HttpRequest.Builder builder =
          HttpRequest.newBuilder(URI.create(baseUrl + path))
              .timeout(timeout)
              .header("Content-Type", "application/json")
              .header("Accept", "application/json")
              .header("X-Tenant-Id", context.tenantId().toString())
              .header("X-User-Id", context.userId().toString())
              .header("X-User-Role", role.name())
              .header("X-User-Permissions", permissions)
              .header("X-Ai-Service-Token", serviceToken)
              .header(CorrelationId.HEADER, CorrelationId.currentOrDefault());
      if (idempotencyKey != null && !idempotencyKey.isBlank()) {
        builder.header("Idempotency-Key", idempotencyKey);
      }
      if (body == null) {
        builder.method("GET", HttpRequest.BodyPublishers.noBody());
      } else {
        builder.POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)));
      }
      HttpResponse<String> response =
          httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() / 100 == 2) {
        return response.body().isBlank()
            ? objectMapper.createObjectNode()
            : objectMapper.readTree(response.body());
      }
      HttpStatus status =
          response.statusCode() == 401
              ? HttpStatus.UNAUTHORIZED
              : response.statusCode() == 403
                  ? HttpStatus.FORBIDDEN
                  : response.statusCode() == 429
                      ? HttpStatus.TOO_MANY_REQUESTS
                      : response.statusCode() >= 500
                          ? HttpStatus.BAD_GATEWAY
                          : HttpStatus.BAD_REQUEST;
      throw new AwapException(
          ErrorCode.GENERIC_INTERNAL_ERROR,
          status,
          "AI Copilot failed with status " + response.statusCode() + ".");
    } catch (IOException ex) {
      throw new AwapException(
          ErrorCode.GENERIC_INTERNAL_ERROR,
          HttpStatus.BAD_GATEWAY,
          "AI Copilot is unreachable: " + ex.getMessage());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new AwapException(
          ErrorCode.GENERIC_INTERNAL_ERROR,
          HttpStatus.BAD_GATEWAY,
          "AI Copilot request was interrupted.");
    }
  }

  private static Role parseRole(String value) {
    try {
      return Role.valueOf(value == null ? "" : value.trim().toUpperCase());
    } catch (IllegalArgumentException ex) {
      throw new AwapException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, "Unknown caller role.");
    }
  }
}

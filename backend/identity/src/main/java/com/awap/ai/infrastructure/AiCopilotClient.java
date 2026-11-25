package com.awap.ai.infrastructure;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.common.correlation.CorrelationId;
import com.awap.identity.domain.Role;
import com.awap.identity.infrastructure.security.TenantContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.stream.Collectors;
import org.springframework.beans.factory.ObjectProvider;
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
  private final MeterRegistry meterRegistry;
  private final GrpcCopilotTransport grpcTransport;

  @Autowired
  public AiCopilotClient(
      @Value("${awap.ai.layer.base-url:http://localhost:8000}") String baseUrl,
      @Value("${awap.ai.internal-token:}") String serviceToken,
      @Value("${awap.ai.copilot.timeout-ms:10000}") long timeoutMs,
      ObjectMapper objectMapper,
      MeterRegistry meterRegistry,
      ObjectProvider<GrpcCopilotTransport> grpcTransport) {
    this(
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(Math.min(Math.max(timeoutMs, 1), 2_000)))
            .build(),
        objectMapper,
        baseUrl,
        serviceToken,
        Duration.ofMillis(Math.max(timeoutMs, 1)),
        meterRegistry,
        grpcTransport.getIfAvailable());
  }

  /**
   * Opens the upstream streamed answer (issue #374). The caller owns the body and must close it; a
   * client disconnect closes it through try-with-resources, which is what cancels generation.
   */
  public HttpResponse<java.io.InputStream> stream(
      String path, JsonNode body, String idempotencyKey) {
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
              .header("Accept", "text/event-stream")
              .header("X-Tenant-Id", context.tenantId().toString())
              .header("X-User-Id", context.userId().toString())
              .header("X-User-Role", role.name())
              .header("X-User-Permissions", permissions)
              .header("X-Ai-Service-Token", serviceToken)
              .header(CorrelationId.HEADER, CorrelationId.currentOrDefault());
      if (idempotencyKey != null && !idempotencyKey.isBlank()) {
        builder.header("Idempotency-Key", idempotencyKey);
      }
      builder.POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)));
      HttpResponse<java.io.InputStream> response =
          httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
      if (response.statusCode() / 100 != 2) {
        try (java.io.InputStream ignored = response.body()) {
          meterRegistry
              .counter(
                  "awap.ai.copilot.stream.failure",
                  "status",
                  Integer.toString(response.statusCode()))
              .increment();
        }
        throw new AwapException(
            ErrorCode.GENERIC_INTERNAL_ERROR,
            HttpStatus.BAD_GATEWAY,
            "The Copilot stream could not be opened.");
      }
      meterRegistry.counter("awap.ai.copilot.stream.opened").increment();
      return response;
    } catch (IOException ex) {
      throw new AwapException(
          ErrorCode.GENERIC_INTERNAL_ERROR,
          HttpStatus.GATEWAY_TIMEOUT,
          "The Copilot stream did not start in time.");
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new AwapException(
          ErrorCode.GENERIC_INTERNAL_ERROR,
          HttpStatus.BAD_GATEWAY,
          "The Copilot stream was interrupted.");
    }
  }

  public AiCopilotClient(
      HttpClient httpClient,
      ObjectMapper objectMapper,
      String baseUrl,
      String serviceToken,
      Duration timeout) {
    this(httpClient, objectMapper, baseUrl, serviceToken, timeout, new SimpleMeterRegistry());
  }

  public AiCopilotClient(
      HttpClient httpClient,
      ObjectMapper objectMapper,
      String baseUrl,
      String serviceToken,
      Duration timeout,
      MeterRegistry meterRegistry) {
    this(httpClient, objectMapper, baseUrl, serviceToken, timeout, meterRegistry, null);
  }

  public AiCopilotClient(
      HttpClient httpClient,
      ObjectMapper objectMapper,
      String baseUrl,
      String serviceToken,
      Duration timeout,
      MeterRegistry meterRegistry,
      GrpcCopilotTransport grpcTransport) {
    this.httpClient = httpClient;
    this.objectMapper = objectMapper;
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    this.serviceToken = serviceToken;
    this.timeout = timeout;
    this.meterRegistry = meterRegistry;
    this.grpcTransport = grpcTransport;
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
    long startedNanos = System.nanoTime();
    String outcome = "ERROR";
    String tier = null;
    boolean cacheHit = false;
    try {
      if (grpcTransport != null && body != null && body.isObject() && isChat(path)) {
        try {
          JsonNode node = grpcTransport.chat(body, context, role, permissions, idempotencyKey);
          tier = node.path("model_tier").asText(null);
          cacheHit = node.path("cache_hit").asBoolean(false);
          outcome = "SUCCESS";
          return node;
        } catch (StatusRuntimeException ex) {
          meterRegistry
              .counter("awap.ai.transport.fallback", "reason", ex.getStatus().getCode().name())
              .increment();
          if (isTerminalGrpc(ex.getStatus().getCode())) {
            throw grpcError(ex);
          }
        } catch (IOException ex) {
          meterRegistry.counter("awap.ai.transport.fallback", "reason", "IO").increment();
        }
      }
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
        JsonNode node =
            response.body().isBlank()
                ? objectMapper.createObjectNode()
                : objectMapper.readTree(response.body());
        tier = node.path("model_tier").asText(null);
        cacheHit = node.path("cache_hit").asBoolean(false);
        recordQueueWait(node);
        outcome = "SUCCESS";
        return node;
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
      // Preserve the AI layer's actionable detail (for example the remaining budget on a 429) so
      // the
      // SPA can explain the failure instead of showing only a generic upstream status.
      String upstreamDetail = "";
      try {
        JsonNode errorBody = objectMapper.readTree(response.body());
        upstreamDetail = errorBody.path("detail").asText("");
      } catch (IOException ignored) {
        // A non-JSON upstream error body is not actionable; keep the status-only message.
      }
      String message = "AI Copilot failed with status " + response.statusCode() + ".";
      if (!upstreamDetail.isBlank()) {
        message = message + " " + upstreamDetail;
      }
      throw new AwapException(ErrorCode.GENERIC_INTERNAL_ERROR, status, message);
    } catch (HttpTimeoutException ex) {
      outcome = "TIMEOUT";
      throw new AwapException(
          ErrorCode.GENERIC_INTERNAL_ERROR,
          HttpStatus.GATEWAY_TIMEOUT,
          "AI Copilot timed out: " + ex.getMessage());
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
    } finally {
      AiLatencyMetrics.recordRequest(
          meterRegistry,
          System.nanoTime() - startedNanos,
          tier,
          actionOf(path),
          outcome,
          cacheHit,
          context.tenantId());
    }
  }

  private static boolean isChat(String path) {
    return "/api/v1/copilot/chat".equals(path);
  }

  static boolean isTerminalGrpc(Status.Code code) {
    return code == Status.Code.UNAUTHENTICATED
        || code == Status.Code.PERMISSION_DENIED
        || code == Status.Code.INVALID_ARGUMENT;
  }

  static AwapException grpcError(StatusRuntimeException ex) {
    Status.Code code = ex.getStatus().getCode();
    HttpStatus status =
        code == Status.Code.UNAUTHENTICATED
            ? HttpStatus.UNAUTHORIZED
            : code == Status.Code.PERMISSION_DENIED ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST;
    return new AwapException(
        ErrorCode.GENERIC_INTERNAL_ERROR, status, "AI Copilot gRPC failed: " + code.name());
  }

  /** Maps a Copilot path to the bounded action tag used by the latency meter. */
  static String actionOf(String path) {
    if (path == null || !path.contains("/copilot/")) {
      return "unknown";
    }
    String suffix = path.substring(path.indexOf("/copilot/") + "/copilot/".length());
    if (suffix.startsWith("jobs")) {
      return "async_job";
    }
    return suffix.replace('/', '_');
  }

  private void recordQueueWait(JsonNode node) {
    JsonNode queueWait = node.path("queue_wait_ms");
    if (queueWait.isNumber()) {
      AiLatencyMetrics.recordQueueWait(meterRegistry, queueWait.asLong());
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

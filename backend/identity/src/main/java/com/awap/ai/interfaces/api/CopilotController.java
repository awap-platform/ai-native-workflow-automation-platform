package com.awap.ai.interfaces.api;

import com.awap.ai.infrastructure.AiCopilotClient;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * Authenticated SPA-facing Copilot proxy. The {@code Idempotency-Key} header is forwarded to the AI
 * layer unchanged and is also placed in the body so the agent can bind it to every state-changing
 * tool (issue #283).
 */
@RestController
@RequestMapping("/api/v1/copilot")
public class CopilotController {

  private static final Logger log = LoggerFactory.getLogger(CopilotController.class);

  private final ObjectProvider<AiCopilotClient> clientProvider;

  public CopilotController(ObjectProvider<AiCopilotClient> clientProvider) {
    this.clientProvider = clientProvider;
  }

  @PostMapping(
      value = "/chat",
      consumes = MediaType.APPLICATION_JSON_VALUE,
      produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> chat(
      @RequestBody JsonNode body,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ResponseEntity.ok(
        client()
            .forward(
                "/api/v1/copilot/chat", withIdempotencyKey(body, idempotencyKey), idempotencyKey));
  }

  /**
   * Relays the versioned SSE answer stream (issue #374). Frames are flushed as they arrive, proxies
   * are told not to buffer, and a client disconnect closes the upstream body, which cancels the
   * provider request instead of billing a turn nobody reads.
   */
  @PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public ResponseEntity<StreamingResponseBody> chatStream(
      @RequestBody JsonNode body,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    java.net.http.HttpResponse<java.io.InputStream> upstream =
        client().stream(
            "/api/v1/copilot/chat/stream",
            withIdempotencyKey(body, idempotencyKey),
            idempotencyKey);
    StreamingResponseBody relay =
        output -> {
          try (java.io.InputStream input = upstream.body()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
              output.write(buffer, 0, read);
              output.flush();
            }
          } catch (java.io.IOException ex) {
            // The browser went away: the try-with-resources close is the cancellation signal.
            log.debug("Copilot stream closed by the client: {}", ex.getMessage());
          }
        };
    return ResponseEntity.ok()
        .contentType(MediaType.TEXT_EVENT_STREAM)
        .header("Cache-Control", "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(relay);
  }

  @GetMapping(value = "/tasks", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> tasks() {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/tasks", null));
  }

  @PostMapping(value = "/tasks/{taskId}/complete", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> completeTask(
      @PathVariable String taskId,
      @RequestBody JsonNode body,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ResponseEntity.ok(
        client()
            .forward(
                "/api/v1/copilot/tasks/" + taskId + "/complete",
                withIdempotencyKey(body, idempotencyKey),
                idempotencyKey));
  }

  @PostMapping(value = "/approvals", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> approvalAssistance(
      @RequestBody JsonNode body,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ResponseEntity.ok(
        client()
            .forward(
                "/api/v1/copilot/approvals",
                withIdempotencyKey(body, idempotencyKey),
                idempotencyKey));
  }

  @PostMapping(value = "/knowledge/search", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> knowledgeSearch(@RequestBody JsonNode body) {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/knowledge/search", body));
  }

  /**
   * Accepts long-running Copilot work. The AI layer owns the job state machine; the proxy keeps the
   * exact body and idempotency key and returns the AI layer's {@code 202} semantics.
   */
  @PostMapping(
      value = "/jobs",
      consumes = MediaType.APPLICATION_JSON_VALUE,
      produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> submitJob(
      @RequestBody JsonNode body,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ResponseEntity.status(HttpStatus.ACCEPTED)
        .body(
            client()
                .forward(
                    "/api/v1/copilot/jobs",
                    withIdempotencyKey(body, idempotencyKey),
                    idempotencyKey));
  }

  @GetMapping(value = "/jobs/{jobId}", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> jobStatus(@PathVariable String jobId) {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/jobs/" + jobId, null));
  }

  @PostMapping(value = "/jobs/{jobId}/cancel", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> cancelJob(@PathVariable String jobId) {
    return ResponseEntity.ok(
        client()
            .forward(
                "/api/v1/copilot/jobs/" + jobId + "/cancel",
                JsonNodeFactory.instance.objectNode()));
  }

  @GetMapping(value = "/prompts", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> prompts() {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/prompts", null));
  }

  @GetMapping(value = "/metrics", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> metrics() {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/metrics", null));
  }

  /**
   * Adds the header key to the body only when the caller did not already send it. The value is
   * never rewritten, so the AI layer sees exactly the client's key.
   */
  static JsonNode withIdempotencyKey(JsonNode body, String idempotencyKey) {
    if (body == null
        || !body.isObject()
        || idempotencyKey == null
        || idempotencyKey.isBlank()
        || body.hasNonNull("idempotency_key")) {
      return body;
    }
    ObjectNode copy = ((ObjectNode) body).deepCopy();
    copy.put("idempotency_key", idempotencyKey);
    return copy;
  }

  private AiCopilotClient client() {
    Optional<AiCopilotClient> client = clientProvider.stream().findFirst();
    return client.orElseThrow(
        () ->
            new AwapException(
                ErrorCode.GENERIC_INTERNAL_ERROR,
                HttpStatus.NOT_IMPLEMENTED,
                "AI Copilot is not enabled in this deployment."));
  }
}

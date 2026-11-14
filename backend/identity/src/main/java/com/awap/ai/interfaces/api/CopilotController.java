package com.awap.ai.interfaces.api;

import com.awap.ai.infrastructure.AiCopilotClient;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Optional;
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

/**
 * Authenticated SPA-facing Copilot proxy. The {@code Idempotency-Key} header is forwarded to the AI
 * layer unchanged and is also placed in the body so the agent can bind it to every state-changing
 * tool (issue #283).
 *
 * <p>The JSON body is read as a raw string and parsed explicitly. The idempotency filter buffers
 * the request body, and explicit parsing keeps the proxy independent of a message-converter choice
 * while still replacing a malformed body with a deterministic 400.
 */
@RestController
@RequestMapping("/api/v1/copilot")
public class CopilotController {

  private final ObjectProvider<AiCopilotClient> clientProvider;
  private final ObjectMapper objectMapper;

  public CopilotController(
      ObjectProvider<AiCopilotClient> clientProvider, ObjectMapper objectMapper) {
    this.clientProvider = clientProvider;
    this.objectMapper = objectMapper;
  }

  @PostMapping(
      value = "/chat",
      consumes = MediaType.APPLICATION_JSON_VALUE,
      produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> chat(
      @RequestBody String body,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ResponseEntity.ok(
        client()
            .forward(
                "/api/v1/copilot/chat",
                withIdempotencyKey(parse(body), idempotencyKey),
                idempotencyKey));
  }

  @GetMapping(value = "/tasks", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> tasks() {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/tasks", null));
  }

  @PostMapping(value = "/tasks/{taskId}/complete", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> completeTask(
      @PathVariable String taskId,
      @RequestBody String body,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ResponseEntity.ok(
        client()
            .forward(
                "/api/v1/copilot/tasks/" + taskId + "/complete",
                withIdempotencyKey(parse(body), idempotencyKey),
                idempotencyKey));
  }

  @PostMapping(value = "/approvals", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> approvalAssistance(
      @RequestBody String body,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ResponseEntity.ok(
        client()
            .forward(
                "/api/v1/copilot/approvals",
                withIdempotencyKey(parse(body), idempotencyKey),
                idempotencyKey));
  }

  @PostMapping(value = "/knowledge/search", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> knowledgeSearch(@RequestBody String body) {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/knowledge/search", parse(body)));
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

  private JsonNode parse(String body) {
    if (body == null || body.isBlank()) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Request body is required.");
    }
    try {
      return objectMapper.readTree(body);
    } catch (JsonProcessingException ex) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED,
          HttpStatus.BAD_REQUEST,
          "Request body is malformed or contains an unsupported value.");
    }
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

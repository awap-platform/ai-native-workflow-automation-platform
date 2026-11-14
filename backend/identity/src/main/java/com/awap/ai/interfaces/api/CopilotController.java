package com.awap.ai.interfaces.api;

import com.awap.ai.infrastructure.AiCopilotClient;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Authenticated SPA-facing Copilot proxy. */
@RestController
@RequestMapping("/api/v1/copilot")
public class CopilotController {

  private final ObjectProvider<AiCopilotClient> clientProvider;

  public CopilotController(ObjectProvider<AiCopilotClient> clientProvider) {
    this.clientProvider = clientProvider;
  }

  @PostMapping(
      value = "/chat",
      consumes = MediaType.APPLICATION_JSON_VALUE,
      produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> chat(@RequestBody JsonNode body) {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/chat", body));
  }

  @GetMapping(value = "/tasks", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> tasks() {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/tasks", null));
  }

  @PostMapping(value = "/tasks/{taskId}/complete", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> completeTask(
      @PathVariable String taskId, @RequestBody JsonNode body) {
    return ResponseEntity.ok(
        client().forward("/api/v1/copilot/tasks/" + taskId + "/complete", body));
  }

  @PostMapping(value = "/approvals", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> approvalAssistance(@RequestBody JsonNode body) {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/approvals", body));
  }

  @PostMapping(value = "/knowledge/search", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> knowledgeSearch(@RequestBody JsonNode body) {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/knowledge/search", body));
  }

  @GetMapping(value = "/prompts", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> prompts() {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/prompts", null));
  }

  @GetMapping(value = "/metrics", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<JsonNode> metrics() {
    return ResponseEntity.ok(client().forward("/api/v1/copilot/metrics", null));
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

package com.awap.engine.application;

import com.awap.identity.infrastructure.security.KafkaTenantContext;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Consumes AI HITL rejection events and fails the linked node/instance deterministically (issue
 * #304). It is deliberately separate from the node-completion listener so a rejection can never
 * advance a workflow.
 */
@Component
@ConditionalOnProperty(name = "awap.kafka.enabled", havingValue = "true")
public class NodeRejectedEventListener {

  private final ObjectMapper objectMapper;
  private final WorkflowEngineService workflowEngineService;
  private final KafkaTenantContext tenantContext;

  public NodeRejectedEventListener(
      ObjectMapper objectMapper,
      WorkflowEngineService workflowEngineService,
      KafkaTenantContext tenantContext) {
    this.objectMapper = objectMapper;
    this.workflowEngineService = workflowEngineService;
    this.tenantContext = tenantContext;
  }

  @KafkaListener(topics = {"workflow.task.rejected.events"})
  public void onMessage(String payload) {
    try {
      NodeRejectedEvent event = objectMapper.readValue(payload, NodeRejectedEvent.class);
      tenantContext.run(event.tenantId(), () -> workflowEngineService.rejectNode(event));
    } catch (JsonProcessingException ex) {
      throw new IllegalArgumentException("Invalid NodeRejectedEvent payload", ex);
    }
  }
}

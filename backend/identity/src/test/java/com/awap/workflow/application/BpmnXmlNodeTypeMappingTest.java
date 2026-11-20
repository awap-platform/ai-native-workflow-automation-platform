package com.awap.workflow.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Imports standard BPMN element names without the awap extension and maps each one. */
class BpmnXmlNodeTypeMappingTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final BpmnXmlService service = new BpmnXmlService(objectMapper);

  @Test
  void mapsEveryStandardElementName() throws Exception {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p">
            <bpmn:startEvent id="startEvent"/>
            <bpmn:endEvent id="endEvent"/>
            <bpmn:userTask id="userTask"/>
            <bpmn:manualTask id="manualTask"/>
            <bpmn:task id="task"/>
            <bpmn:serviceTask id="serviceTask"/>
            <bpmn:scriptTask id="scriptTask"/>
            <bpmn:sendTask id="sendTask"/>
            <bpmn:receiveTask id="receiveTask"/>
            <bpmn:callActivity id="callActivity"/>
            <bpmn:exclusiveGateway id="exclusiveGateway"/>
            <bpmn:inclusiveGateway id="inclusiveGateway"/>
            <bpmn:parallelGateway id="parallelGateway"/>
            <bpmn:intermediateCatchEvent id="intermediateCatchEvent"/>
          </bpmn:process>
        </bpmn:definitions>
        """;

    Map<String, String> types = new HashMap<>();
    JsonNode nodes =
        objectMapper.readTree(service.importDefinition(xml).definitionJson()).get("nodes");
    for (JsonNode node : nodes) {
      types.put(node.get("id").asText(), node.get("type").asText());
    }

    assertThat(types)
        .containsEntry("startEvent", "START")
        .containsEntry("endEvent", "END")
        .containsEntry("userTask", "TASK")
        .containsEntry("manualTask", "TASK")
        .containsEntry("task", "TASK")
        .containsEntry("serviceTask", "SCRIPT")
        .containsEntry("scriptTask", "SCRIPT")
        .containsEntry("sendTask", "WEBHOOK")
        .containsEntry("receiveTask", "WEBHOOK")
        .containsEntry("callActivity", "SUB_PROCESS")
        .containsEntry("exclusiveGateway", "DECISION")
        .containsEntry("inclusiveGateway", "DECISION")
        .containsEntry("parallelGateway", "PARALLEL_GATEWAY")
        .containsEntry("intermediateCatchEvent", "DELAY");
  }
}

package com.awap.workflow.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class BpmnXmlServiceTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final BpmnXmlService service = new BpmnXmlService(objectMapper);

  private static final String DEFINITION =
      """
      {
        "nodes": [
          {"id":"start","type":"START","name":"Start"},
          {"id":"approve","type":"APPROVAL","name":"Manager approval",
           "config":{"assignee":"role:MANAGER","timeoutSeconds":30}},
          {"id":"gateway","type":"DECISION","name":"Amount check",
           "config":{"expression":"#amount > 100"}},
          {"id":"hook","type":"WEBHOOK","name":"Notify",
           "config":{"url":"https://example.test/hook","maxAttempts":3}},
          {"id":"end","type":"END","name":"Done"}
        ],
        "transitions": [
          {"id":"t1","from":"start","to":"approve"},
          {"id":"t2","from":"approve","to":"gateway","condition":"#amount > 100 && #role == 'MANAGER'"},
          {"id":"t3","from":"gateway","to":"hook","condition":"#fn.matches(#code, '^[A-Z]+$')"},
          {"id":"t4","from":"hook","to":"end"}
        ]
      }
      """;

  @Test
  void serializeAndParseRoundTripsTheDefinitionDeepEqual() throws Exception {
    String xml = service.exportDefinition(DEFINITION);

    assertThat(xml).contains("bpmn:definitions").contains("awap:nodeType");
    BpmnXmlService.ImportResult result = service.importDefinition(xml);

    JsonNode original = objectMapper.readTree(DEFINITION);
    JsonNode imported = objectMapper.readTree(result.definitionJson());
    assertThat(imported).isEqualTo(original);
    assertThat(result.warnings()).isEmpty();
  }

  @Test
  void conditionsAreXmlEscapedAndRestoredVerbatim() throws Exception {
    String definition =
        """
        {"nodes":[{"id":"s","type":"START"},{"id":"e","type":"END"}],
         "transitions":[{"id":"t","from":"s","to":"e","condition":"#amount < 10 && #name == 'a&b'"}]}
        """;

    String xml = service.exportDefinition(definition);
    assertThat(xml).contains("<");
    assertThat(xml).contains("&");

    JsonNode imported = objectMapper.readTree(service.importDefinition(xml).definitionJson());
    assertThat(imported).isEqualTo(objectMapper.readTree(definition));
  }

  @Test
  void rejectsDoctypeAndExternalEntities() {
    String xxe =
        """
        <?xml version="1.0"?>
        <!DOCTYPE definitions [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p">
            <bpmn:startEvent id="s" name="&xxe;"/>
          </bpmn:process>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xxe))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).containsIgnoringCase("doctype");
              assertThat(exception.getMessage()).doesNotContain("root:");
            });
  }

  @Test
  void rejectsOversizedXmlWith413() {
    String oversized = "a".repeat(BpmnXmlService.MAX_XML_LENGTH + 1);

    assertThatThrownBy(() -> service.importDefinition(oversized))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
              assertThat(exception.errorCode()).isEqualTo(ErrorCode.PAYLOAD_TOO_LARGE);
            });
  }

  @Test
  void malformedXmlReportsTheLine() {
    String malformed = "<bpmn:definitions>\n  <bpmn:process>\n</bpmn:definitions>";

    assertThatThrownBy(() -> service.importDefinition(malformed))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("line").contains("not well-formed");
            });
  }

  @Test
  void missingProcessIsRejectedWithALineReference() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("line").contains("no process");
            });
  }

  @Test
  void sequenceFlowWithAMissingEndpointIsRejectedAtItsLine() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/>
            <bpmn:sequenceFlow id="t1" sourceRef="s" targetRef="missing"/>
          </bpmn:process>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage())
                  .contains("line 4")
                  .contains("not part of the process");
            });
  }

  @Test
  void unsupportedExtensionNodeTypeIsRejected() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:awap="https://awap.dev/schema/bpmn">
          <bpmn:process id="p">
            <bpmn:userTask id="s">
              <bpmn:extensionElements><awap:nodeType>NOT_A_NODE</awap:nodeType></bpmn:extensionElements>
            </bpmn:userTask>
          </bpmn:process>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("Unsupported awap:nodeType");
            });
  }

  @Test
  void invalidConfigJsonIsRejected() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:awap="https://awap.dev/schema/bpmn">
          <bpmn:process id="p">
            <bpmn:startEvent id="s">
              <bpmn:extensionElements><awap:config>{not-json}</awap:config></bpmn:extensionElements>
            </bpmn:startEvent>
          </bpmn:process>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("awap:config");
            });
  }

  @Test
  void exportRejectsADefinitionWithoutNodes() {
    assertThatThrownBy(() -> service.exportDefinition("{\"nodes\":[]}"))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST));
  }
}

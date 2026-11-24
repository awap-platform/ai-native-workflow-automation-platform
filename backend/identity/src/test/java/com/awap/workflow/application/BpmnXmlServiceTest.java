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

  @Test
  void exportAndImportPreserveNodeGeometryAndEdgeWaypoints() throws Exception {
    String definition =
        """
        {"nodes":[
          {"id":"start","type":"START","di":{"x":120,"y":80,"width":200,"height":70,
           "laneId":"lane-1","poolId":"pool-1"}},
          {"id":"end","type":"END","di":{"x":460,"y":300,"width":180,"height":64}}],
         "transitions":[{"id":"t1","from":"start","to":"end",
           "di":{"waypoints":[{"x":220,"y":150},{"x":550,"y":300}],
                 "labelPosition":{"x":300,"y":180}}}]}
        """;

    String xml = service.exportDefinition(definition);
    assertThat(xml)
        .contains("bpmndi:BPMNDiagram")
        .contains("bpmndi:BPMNPlane")
        .contains("bpmndi:BPMNShape")
        .contains("bpmndi:BPMNEdge")
        .contains("di:waypoint")
        .contains("dc:Bounds");

    JsonNode imported = objectMapper.readTree(service.importDefinition(xml).definitionJson());
    JsonNode start = imported.get("nodes").get(0).get("di");
    assertThat(start.get("x").asDouble()).isEqualTo(120d);
    assertThat(start.get("y").asDouble()).isEqualTo(80d);
    assertThat(start.get("width").asDouble()).isEqualTo(200d);
    assertThat(start.get("height").asDouble()).isEqualTo(70d);
    assertThat(start.get("laneId").asText()).isEqualTo("lane-1");
    assertThat(start.get("poolId").asText()).isEqualTo("pool-1");

    JsonNode transition = imported.get("transitions").get(0).get("di");
    assertThat(transition.get("waypoints")).hasSize(2);
    assertThat(transition.get("waypoints").get(0).get("x").asDouble()).isEqualTo(220d);
    assertThat(transition.get("waypoints").get(1).get("y").asDouble()).isEqualTo(300d);
    assertThat(transition.get("labelPosition").get("x").asDouble()).isEqualTo(300d);
  }

  @Test
  void exportGeneratesDeterministicDiWhenAbsentAndImportDropsIt() throws Exception {
    String definition =
        """
        {"nodes":[{"id":"s","type":"START"},{"id":"e","type":"END"}],
         "transitions":[{"id":"t","from":"s","to":"e"}]}
        """;

    String first = service.exportDefinition(definition);
    String second = service.exportDefinition(definition);
    assertThat(first).isEqualTo(second);
    assertThat(first).contains("awap:diGenerated=\"true\"");

    JsonNode imported = objectMapper.readTree(service.importDefinition(first).definitionJson());
    assertThat(imported).isEqualTo(objectMapper.readTree(definition));
    assertThat(imported.get("nodes").get(0).has("di")).isFalse();
    assertThat(imported.get("transitions").get(0).has("di")).isFalse();
  }

  @Test
  void importsExternalBpmnDiGeometry() throws Exception {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
            xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
            xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/>
            <bpmn:endEvent id="e"/>
            <bpmn:sequenceFlow id="t" sourceRef="s" targetRef="e"/>
          </bpmn:process>
          <bpmndi:BPMNDiagram id="d">
            <bpmndi:BPMNPlane id="p1" bpmnElement="p">
              <bpmndi:BPMNShape id="shape-s" bpmnElement="s">
                <dc:Bounds x="100" y="50" width="180" height="64"/>
              </bpmndi:BPMNShape>
              <bpmndi:BPMNEdge id="edge-t" bpmnElement="t">
                <di:waypoint x="190" y="114"/>
                <di:waypoint x="190" y="260"/>
              </bpmndi:BPMNEdge>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;

    JsonNode imported = objectMapper.readTree(service.importDefinition(xml).definitionJson());
    assertThat(imported.get("nodes").get(0).get("di").get("x").asDouble()).isEqualTo(100d);
    assertThat(imported.get("nodes").get(0).get("di").get("height").asDouble()).isEqualTo(64d);
    assertThat(imported.get("transitions").get(0).get("di").get("waypoints")).hasSize(2);
  }

  @Test
  void rejectsScriptTaskWithAnExecutableScriptBody() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p">
            <bpmn:scriptTask id="script" scriptFormat="groovy">
              <bpmn:script>System.exit(1)</bpmn:script>
            </bpmn:scriptTask>
          </bpmn:process>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("Script tasks are not supported");
            });
  }

  @Test
  void rejectsMoreWaypointsThanTheLimit() {
    StringBuilder waypoints = new StringBuilder();
    for (int index = 0; index <= BpmnXmlService.MAX_DI_WAYPOINTS; index++) {
      waypoints.append("<di:waypoint x=\"").append(index).append("\" y=\"0\"/>");
    }
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
            xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/><bpmn:endEvent id="e"/>
            <bpmn:sequenceFlow id="t" sourceRef="s" targetRef="e"/>
          </bpmn:process>
          <bpmndi:BPMNDiagram id="d">
            <bpmndi:BPMNPlane id="p1" bpmnElement="p">
              <bpmndi:BPMNEdge id="edge-t" bpmnElement="t">
        """
            + waypoints
            + """
              </bpmndi:BPMNEdge>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("waypoint limit");
            });
  }

  @Test
  void regeneratesAnEmptyWaypointListInsteadOfWritingAnInvalidEdge() {
    String xml =
        service.exportDefinition(
            "{\"nodes\":[{\"id\":\"s\",\"type\":\"START\"},{\"id\":\"e\",\"type\":\"END\"}],"
                + "\"transitions\":[{\"id\":\"t\",\"from\":\"s\",\"to\":\"e\","
                + "\"di\":{\"waypoints\":[]}}]}");

    assertThat(xml).contains("awap:diGenerated=\"true\"").contains("di:waypoint");
  }

  @Test
  void regeneratesAWaypointWithNonNumericCoordinates() {
    String xml =
        service.exportDefinition(
            "{\"nodes\":[{\"id\":\"s\",\"type\":\"START\"},{\"id\":\"e\",\"type\":\"END\"}],"
                + "\"transitions\":[{\"id\":\"t\",\"from\":\"s\",\"to\":\"e\","
                + "\"di\":{\"waypoints\":[{\"x\":\"bad\",\"y\":1}]}}]}");

    assertThat(xml).contains("awap:diGenerated=\"true\"");
  }

  @Test
  void preservesFractionalCoordinatesAndASelfLoopWaypoint() throws Exception {
    String definition =
        """
        {"nodes":[{"id":"loop","type":"TASK",
          "di":{"x":100.5,"y":60.25,"width":180.5,"height":64.5}}],
         "transitions":[{"id":"t","from":"loop","to":"loop"}]}
        """;

    String xml = service.exportDefinition(definition);
    JsonNode imported = objectMapper.readTree(service.importDefinition(xml).definitionJson());
    assertThat(imported.get("nodes").get(0).get("di").get("x").asDouble()).isEqualTo(100.5d);
    assertThat(imported.get("nodes").get(0).get("di").get("width").asDouble()).isEqualTo(180.5d);
    assertThat(imported.get("transitions").get(0).get("di")).isNull();
  }

  @Test
  void exportsAGeneratedSelfLoopWithAThirdWaypoint() {
    String xml =
        service.exportDefinition(
            "{\"nodes\":[{\"id\":\"loop\",\"type\":\"TASK\"}],"
                + "\"transitions\":[{\"id\":\"t\",\"from\":\"loop\",\"to\":\"loop\"}]}");

    assertThat(xml).contains("di:waypoint");
    // Source center-bottom and target center-top are identical for a one-node loop, so the
    // generator inserts a middle point instead of a zero-length edge.
    assertThat(xml.split("<di:waypoint", -1).length - 1).isEqualTo(3);
  }

  @Test
  void ignoresDiagramEdgesWithoutWaypoints() throws Exception {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/><bpmn:endEvent id="e"/>
            <bpmn:sequenceFlow id="t" sourceRef="s" targetRef="e"/>
          </bpmn:process>
          <bpmndi:BPMNDiagram id="d">
            <bpmndi:BPMNPlane id="p1" bpmnElement="p">
              <bpmndi:BPMNEdge id="edge-t" bpmnElement="t"/>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;

    JsonNode imported = objectMapper.readTree(service.importDefinition(xml).definitionJson());
    assertThat(imported.get("transitions").get(0).has("di")).isFalse();
  }

  @Test
  void rejectsAnEdgeWaypointWithoutAnXAttribute() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
            xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/><bpmn:endEvent id="e"/>
            <bpmn:sequenceFlow id="t" sourceRef="s" targetRef="e"/>
          </bpmn:process>
          <bpmndi:BPMNDiagram id="d">
            <bpmndi:BPMNPlane id="p1" bpmnElement="p">
              <bpmndi:BPMNEdge id="edge-t" bpmnElement="t">
                <di:waypoint y="1"/>
              </bpmndi:BPMNEdge>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("without numeric x/y");
            });
  }

  @Test
  void rejectsAnEdgeWaypointWithoutNumericCoordinates() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
            xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/><bpmn:endEvent id="e"/>
            <bpmn:sequenceFlow id="t" sourceRef="s" targetRef="e"/>
          </bpmn:process>
          <bpmndi:BPMNDiagram id="d">
            <bpmndi:BPMNPlane id="p1" bpmnElement="p">
              <bpmndi:BPMNEdge id="edge-t" bpmnElement="t">
                <di:waypoint x="nope" y="1"/>
              </bpmndi:BPMNEdge>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("without numeric x/y");
            });
  }

  @Test
  void rejectsALabelWithoutNumericCoordinates() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
            xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
            xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/><bpmn:endEvent id="e"/>
            <bpmn:sequenceFlow id="t" sourceRef="s" targetRef="e"/>
          </bpmn:process>
          <bpmndi:BPMNDiagram id="d">
            <bpmndi:BPMNPlane id="p1" bpmnElement="p">
              <bpmndi:BPMNEdge id="edge-t" bpmnElement="t">
                <di:waypoint x="1" y="2"/>
                <bpmndi:BPMNLabel><dc:Bounds x="nope" y="2"/></bpmndi:BPMNLabel>
              </bpmndi:BPMNEdge>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("label without numeric x/y");
            });
  }

  @Test
  void rejectsAShapeWithoutBounds() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI">
          <bpmn:process id="p"><bpmn:startEvent id="s"/></bpmn:process>
          <bpmndi:BPMNDiagram id="d">
            <bpmndi:BPMNPlane id="p1" bpmnElement="p">
              <bpmndi:BPMNShape id="shape-s" bpmnElement="s"/>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("has no dc:Bounds");
            });
  }

  @Test
  void rejectsAShapeWithoutNumericBounds() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
            xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
          <bpmn:process id="p"><bpmn:startEvent id="s"/></bpmn:process>
          <bpmndi:BPMNDiagram id="d">
            <bpmndi:BPMNPlane id="p1" bpmnElement="p">
              <bpmndi:BPMNShape id="shape-s" bpmnElement="s">
                <dc:Bounds x="abc" y="50" width="180" height="64"/>
              </bpmndi:BPMNShape>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;

    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> {
              assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(exception.getMessage()).contains("invalid x/y/width/height");
            });
  }
}

package com.awap.workflow.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.withSettings;

import com.awap.common.api.AwapException;
import com.fasterxml.jackson.core.JsonGenerationException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.Reader;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;

/** Error paths and the full node-type matrix for {@link BpmnXmlService}. */
class BpmnXmlServiceExtendedTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final BpmnXmlService service = new BpmnXmlService(objectMapper);

  private static final String BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL";

  @Test
  void exportsAndImportsEverySupportedNodeType() throws Exception {
    String definition =
        """
        {"nodes":[
          {"id":"s","type":"START"},
          {"id":"t","type":"TASK"},
          {"id":"a","type":"APPROVAL","config":{"approvers":["role:MANAGER"]}},
          {"id":"f","type":"FORM","config":{"formId":"form-1"}},
          {"id":"d","type":"DECISION"},
          {"id":"c","type":"CONDITION"},
          {"id":"p","type":"PARALLEL"},
          {"id":"pg","type":"PARALLEL_GATEWAY"},
          {"id":"m","type":"MERGE"},
          {"id":"mg","type":"MERGE_GATEWAY"},
          {"id":"delay","type":"DELAY","config":{"delaySeconds":5}},
          {"id":"web","type":"WEBHOOK","config":{"url":"https://example.test"}},
          {"id":"sub","type":"SUB_PROCESS","config":{"workflowDefinitionId":"child","version":2}},
          {"id":"ai","type":"AI","config":{"approvers":["role:MANAGER"]}},
          {"id":"ait","type":"AI_TASK","config":{"approvers":["role:MANAGER"]}},
          {"id":"script","type":"SCRIPT","config":{"script":"#amount * 2"}},
          {"id":"e","type":"END"}],
         "transitions":[
          {"id":"1","from":"s","to":"t"},{"id":"2","from":"t","to":"a"},
          {"id":"3","from":"a","to":"f"},{"id":"4","from":"f","to":"d"},
          {"id":"5","from":"d","to":"c"},{"id":"6","from":"c","to":"p"},
          {"id":"7","from":"p","to":"pg"},{"id":"8","from":"pg","to":"m"},
          {"id":"9","from":"m","to":"mg"},{"id":"10","from":"mg","to":"delay"},
          {"id":"11","from":"delay","to":"web"},{"id":"12","from":"web","to":"sub"},
          {"id":"13","from":"sub","to":"ai"},{"id":"14","from":"ai","to":"ait"},
          {"id":"15","from":"ait","to":"script"},{"id":"16","from":"script","to":"e"}]}
        """;

    String xml = service.exportDefinition(definition);
    assertThat(xml).contains("bpmn:parallelGateway").contains("bpmn:sendTask");
    assertThat(objectMapper.readTree(service.importDefinition(xml).definitionJson()))
        .isEqualTo(objectMapper.readTree(definition));
  }

  @Test
  void exportReadsTheLegacyEdgesArray() throws Exception {
    String xml =
        service.exportDefinition(
            "{\"nodes\":[{\"id\":\"s\",\"type\":\"START\"},{\"id\":\"e\",\"type\":\"END\"}],"
                + "\"edges\":[{\"id\":\"t\",\"from\":\"s\",\"to\":\"e\"}]}");
    var imported = objectMapper.readTree(service.importDefinition(xml).definitionJson());
    assertThat(imported.get("transitions")).hasSize(1);
  }

  @Test
  void exportRejectsABlankDefinition() {
    assertThatThrownBy(() -> service.exportDefinition("  "))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("definition is required");
  }

  @Test
  void exportRejectsInvalidJson() {
    assertThatThrownBy(() -> service.exportDefinition("{not json"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("not valid JSON");
  }

  @Test
  void exportRejectsANodeWithoutAnId() {
    assertThatThrownBy(
            () -> service.exportDefinition("{\"nodes\":[{\"type\":\"START\"}],\"transitions\":[]}"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("needs an id");
  }

  @Test
  void exportRejectsDuplicateNodeIds() {
    assertThatThrownBy(
            () ->
                service.exportDefinition(
                    "{\"nodes\":[{\"id\":\"n\",\"type\":\"START\"},{\"id\":\"n\",\"type\":\"END\"}]}"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Duplicate node id");
  }

  @Test
  void exportRejectsANodeWithoutAType() {
    assertThatThrownBy(
            () -> service.exportDefinition("{\"nodes\":[{\"id\":\"n\"}],\"transitions\":[]}"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("needs a type");
  }

  @Test
  void exportRejectsAnUnsupportedNodeType() {
    assertThatThrownBy(
            () ->
                service.exportDefinition(
                    "{\"nodes\":[{\"id\":\"n\",\"type\":\"NOT_A_NODE\"}],\"transitions\":[]}"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Unsupported workflow node type");
  }

  @Test
  void exportRejectsNonArrayTransitions() {
    assertThatThrownBy(
            () ->
                service.exportDefinition(
                    "{\"nodes\":[{\"id\":\"n\",\"type\":\"START\"}],\"transitions\":{}}"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("transitions must be an array");
  }

  @Test
  void exportRejectsATransitionWithAnUnknownEndpoint() {
    assertThatThrownBy(
            () ->
                service.exportDefinition(
                    "{\"nodes\":[{\"id\":\"n\",\"type\":\"START\"}],"
                        + "\"transitions\":[{\"id\":\"t\",\"from\":\"n\",\"to\":\"ghost\"}]}"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("existing nodes");
  }

  @Test
  void exportFailsWhenTheConfigCannotBeSerialized() throws Exception {
    ObjectMapper failing =
        mock(
            ObjectMapper.class,
            withSettings()
                .spiedInstance(new ObjectMapper())
                .defaultAnswer(org.mockito.Mockito.CALLS_REAL_METHODS));
    doThrow(new JsonGenerationException("boom", (com.fasterxml.jackson.core.JsonGenerator) null))
        .when(failing)
        .writeValueAsString(any());
    BpmnXmlService failingService = new BpmnXmlService(failing);

    assertThatThrownBy(
            () ->
                failingService.exportDefinition(
                    "{\"nodes\":[{\"id\":\"n\",\"type\":\"TASK\",\"config\":{\"a\":1}}]}"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("could not be serialized");
  }

  @Test
  void importRejectsBlankXml() {
    assertThatThrownBy(() -> service.importDefinition(null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("BPMN XML is required");
  }

  @Test
  void importRejectsANonDefinitionsRoot() {
    assertThatThrownBy(() -> service.importDefinition("<foo/>"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("root element must be bpmn:definitions");
  }

  @Test
  void importIgnoresNonNodeElements() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p">
            <bpmn:laneSet id="lanes"/>
            <bpmn:startEvent id="s"/>
          </bpmn:process>
        </bpmn:definitions>
        """;
    assertThat(service.importDefinition(xml).definitionJson()).contains("\"START\"");
  }

  @Test
  void importRejectsANodeWithoutAnId() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p"><bpmn:startEvent/></bpmn:process>
        </bpmn:definitions>
        """;
    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Every BPMN node needs an id");
  }

  @Test
  void importRejectsDuplicateNodeIds() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p">
            <bpmn:startEvent id="same"/>
            <bpmn:endEvent id="same"/>
          </bpmn:process>
        </bpmn:definitions>
        """;
    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Duplicate BPMN node id");
  }

  @Test
  void importRejectsASequenceFlowWithoutAnId() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/><bpmn:endEvent id="e"/>
            <bpmn:sequenceFlow sourceRef="s" targetRef="e"/>
          </bpmn:process>
        </bpmn:definitions>
        """;
    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("needs an id");
  }

  @Test
  void importRejectsASequenceFlowWithoutEndpoints() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:process id="p">
            <bpmn:startEvent id="s"/>
            <bpmn:sequenceFlow id="t" sourceRef="s"/>
          </bpmn:process>
        </bpmn:definitions>
        """;
    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("needs sourceRef and targetRef");
  }

  @Test
  void importRejectsANonObjectConfig() {
    String xml =
        """
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
            xmlns:awap="https://awap.dev/schema/bpmn">
          <bpmn:process id="p">
            <bpmn:startEvent id="s">
              <bpmn:extensionElements><awap:config>[]</awap:config></bpmn:extensionElements>
            </bpmn:startEvent>
          </bpmn:process>
        </bpmn:definitions>
        """;
    assertThatThrownBy(() -> service.importDefinition(xml))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("must be a JSON object");
  }

  @Test
  void importRejectsAnUnknownBpmnElementWhenTheTypeIsResolvedDirectly() throws Exception {
    Document document = DocumentBuilderFactory.newInstance().newDocumentBuilder().newDocument();
    Element element = document.createElementNS(BPMN_NS, "bpmn:boundaryEvent");
    element.setAttribute("id", "boundary");

    assertThatThrownBy(() -> service.nodeType(element, "boundaryEvent", "<bpmn:boundaryEvent/>"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Unsupported BPMN element");
  }

  @Test
  void parseWrapsAnIoFailureAsAValidationError() {
    Reader failingReader =
        new Reader() {
          @Override
          public int read(char[] buffer, int offset, int length) throws IOException {
            throw new IOException("reader exploded");
          }

          @Override
          public void close() {
            // Nothing to close.
          }
        };

    assertThatThrownBy(() -> service.parse(new InputSource(failingReader)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("could not be parsed");
  }

  @Test
  void newDocumentFailureIsAnIllegalState() {
    BpmnXmlService broken =
        new BpmnXmlService(objectMapper) {
          @Override
          DocumentBuilderFactory hardenedFactory() throws ParserConfigurationException {
            throw new ParserConfigurationException("no factory");
          }
        };

    assertThatThrownBy(
            () -> broken.exportDefinition("{\"nodes\":[{\"id\":\"n\",\"type\":\"START\"}]}"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("document builder is unavailable");
  }

  @Test
  void parserConfigurationFailureIsAValidationErrorOnImport() {
    BpmnXmlService broken =
        new BpmnXmlService(objectMapper) {
          @Override
          DocumentBuilderFactory hardenedFactory() throws ParserConfigurationException {
            throw new ParserConfigurationException("no factory");
          }
        };

    assertThatThrownBy(() -> broken.importDefinition("<bpmn:definitions/>"))
        .isInstanceOfSatisfying(
            AwapException.class,
            exception -> assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void serializeWrapsATransformerFailure() {
    BpmnXmlService broken =
        new BpmnXmlService(objectMapper) {
          @Override
          javax.xml.transform.Transformer newTransformer()
              throws javax.xml.transform.TransformerException {
            throw new javax.xml.transform.TransformerException("no transformer");
          }
        };

    assertThatThrownBy(
            () -> broken.exportDefinition("{\"nodes\":[{\"id\":\"n\",\"type\":\"START\"}]}"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("could not be serialized");
  }
}

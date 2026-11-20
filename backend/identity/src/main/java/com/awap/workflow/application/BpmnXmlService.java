package com.awap.workflow.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.workflow.domain.NodeType;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.ErrorHandler;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

/**
 * Minimal BPMN 2.0 import/export for the internal workflow definition JSON.
 *
 * <p>The converter deliberately covers the subset of BPMN that maps onto the engine's node types.
 * The original node type and config are stored in the {@code awap} extension namespace, so a
 * definition survives a round-trip without losing engine-specific settings. Diagram interchange
 * (positions and lanes) is not preserved; see the phase 5 document for the honest limitations.
 *
 * <p>Parsing is hardened against XXE and entity-expansion attacks: DTDs are rejected, external
 * entities and external schema/DTD access are disabled, and secure processing is enabled. XML
 * larger than {@link #MAX_XML_LENGTH} is rejected with 413 before the parser sees it.
 */
@Service
public class BpmnXmlService {

  /** One megabyte is enough for large diagrams while capping parser work per request. */
  public static final int MAX_XML_LENGTH = 1_000_000;

  private static final String BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL";
  private static final String AWAP_NS = "https://awap.dev/schema/bpmn";
  private static final String XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

  private final ObjectMapper objectMapper;

  public BpmnXmlService(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  /** Result of an import, including warnings for BPMN constructs that were ignored. */
  public record ImportResult(String definitionJson, List<String> warnings) {}

  /** Serializes the internal definition JSON to BPMN 2.0 XML. */
  public String exportDefinition(String definitionJson) {
    if (definitionJson == null || definitionJson.isBlank()) {
      throw invalidDefinition("A workflow definition is required.");
    }
    JsonNode root;
    try {
      root = objectMapper.readTree(definitionJson);
    } catch (JsonProcessingException ex) {
      throw invalidDefinition("The workflow definition is not valid JSON.");
    }
    JsonNode nodes = root.get("nodes");
    if (nodes == null || !nodes.isArray() || nodes.isEmpty()) {
      throw invalidDefinition("The workflow definition needs a non-empty nodes array.");
    }

    Document document = newDocument();
    Element definitions = document.createElementNS(BPMN_NS, "bpmn:definitions");
    definitions.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:bpmn", BPMN_NS);
    definitions.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:awap", AWAP_NS);
    definitions.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:xsi", XSI_NS);
    definitions.setAttribute("targetNamespace", "https://awap.dev/bpmn");
    document.appendChild(definitions);

    Element process = document.createElementNS(BPMN_NS, "bpmn:process");
    process.setAttribute("id", "workflow");
    process.setAttribute("isExecutable", "true");
    definitions.appendChild(process);

    Set<String> nodeIds = new HashSet<>();
    for (JsonNode node : nodes) {
      String id = text(node, "id");
      String typeName = text(node, "type");
      if (id == null || id.isBlank()) {
        throw invalidDefinition("Every workflow node needs an id.");
      }
      if (!nodeIds.add(id)) {
        throw invalidDefinition("Duplicate node id '" + id + "'.");
      }
      NodeType type = parseType(typeName);
      Element element = document.createElementNS(BPMN_NS, elementName(type));
      element.setAttribute("id", id);
      String name = text(node, "name");
      if (name != null && !name.isBlank()) {
        element.setAttribute("name", name);
      }
      if (type == NodeType.DELAY) {
        element.appendChild(document.createElementNS(BPMN_NS, "bpmn:timerEventDefinition"));
      }
      JsonNode config = node.get("config");
      if (type == NodeType.SUB_PROCESS
          && config != null
          && config.hasNonNull("workflowDefinitionId")) {
        element.setAttribute("calledElement", config.get("workflowDefinitionId").asText());
      }
      appendExtension(document, element, type.name(), config);
      process.appendChild(element);
    }

    JsonNode transitions = root.get("transitions");
    if (transitions == null) {
      transitions = root.get("edges");
    }
    if (transitions != null && !transitions.isArray()) {
      throw invalidDefinition("The transitions must be an array.");
    }
    if (transitions != null) {
      int index = 0;
      for (JsonNode transition : transitions) {
        String from = text(transition, "from");
        String to = text(transition, "to");
        if (from == null || to == null || !nodeIds.contains(from) || !nodeIds.contains(to)) {
          throw invalidDefinition("Transition endpoints must reference existing nodes.");
        }
        String id = text(transition, "id");
        Element flow = document.createElementNS(BPMN_NS, "bpmn:sequenceFlow");
        flow.setAttribute("id", id == null || id.isBlank() ? "transition-" + index : id);
        flow.setAttribute("sourceRef", from);
        flow.setAttribute("targetRef", to);
        String condition = text(transition, "condition");
        if (condition != null && !condition.isBlank()) {
          Element expression = document.createElementNS(BPMN_NS, "bpmn:conditionExpression");
          expression.setAttributeNS(XSI_NS, "xsi:type", "bpmn:tFormalExpression");
          expression.setTextContent(condition);
          flow.appendChild(expression);
        }
        process.appendChild(flow);
        index++;
      }
    }

    return serialize(document);
  }

  /**
   * Parses BPMN XML into the internal definition JSON.
   *
   * @throws AwapException 400 for malformed or semantically invalid BPMN (the message carries the
   *     line of the offending construct) and 413 for oversized XML
   */
  public ImportResult importDefinition(String bpmnXml) {
    if (bpmnXml == null || bpmnXml.isBlank()) {
      throw invalidBpmn(1, "BPMN XML is required.");
    }
    if (bpmnXml.length() > MAX_XML_LENGTH) {
      throw new AwapException(
          ErrorCode.PAYLOAD_TOO_LARGE,
          HttpStatus.PAYLOAD_TOO_LARGE,
          "BPMN XML exceeds the maximum size of " + MAX_XML_LENGTH + " characters.");
    }

    Document document = parse(bpmnXml);
    Element root = document.getDocumentElement();
    if (root == null || !"definitions".equals(localName(root))) {
      throw invalidBpmn(1, "The root element must be bpmn:definitions.");
    }
    Element process = firstDescendant(root, "process");
    if (process == null) {
      throw invalidBpmn(lineOf(bpmnXml, "process"), "The BPMN document has no process.");
    }

    List<String> warnings = new ArrayList<>();
    ObjectNode definition = objectMapper.createObjectNode();
    ArrayNode nodes = definition.putArray("nodes");
    ArrayNode transitions = definition.putArray("transitions");
    Set<String> nodeIds = new HashSet<>();

    for (Element element : childElements(process)) {
      String name = localName(element);
      if ("sequenceFlow".equals(name) || !isNodeElement(name)) {
        continue;
      }
      String id = element.getAttribute("id");
      if (id == null || id.isBlank()) {
        throw invalidBpmn(lineOfElement(bpmnXml, element), "Every BPMN node needs an id.");
      }
      if (!nodeIds.add(id)) {
        throw invalidBpmn(lineOfElement(bpmnXml, element), "Duplicate BPMN node id '" + id + "'.");
      }
      NodeType type = nodeType(element, name, bpmnXml);
      ObjectNode node = nodes.addObject();
      node.put("id", id);
      node.put("type", type.name());
      String label = element.getAttribute("name");
      if (label != null && !label.isBlank()) {
        node.put("name", label);
      }
      JsonNode config = configOf(element, bpmnXml);
      if (config != null) {
        node.set("config", config);
      }
      if (type == NodeType.SUB_PROCESS && element.hasAttribute("calledElement")) {
        ObjectNode mutable =
            config instanceof ObjectNode object ? object : objectMapper.createObjectNode();
        mutable.put("workflowDefinitionId", element.getAttribute("calledElement"));
        node.set("config", mutable);
      }
    }

    int index = 0;
    for (Element flow : childElements(process)) {
      if (!"sequenceFlow".equals(localName(flow))) {
        continue;
      }
      String id = flow.getAttribute("id");
      String from = flow.getAttribute("sourceRef");
      String to = flow.getAttribute("targetRef");
      int line = lineOfElement(bpmnXml, flow);
      if (id == null || id.isBlank()) {
        throw invalidBpmn(line, "Every sequence flow needs an id.");
      }
      if (from == null || from.isBlank() || to == null || to.isBlank()) {
        throw invalidBpmn(line, "Sequence flow '" + id + "' needs sourceRef and targetRef.");
      }
      if (!nodeIds.contains(from) || !nodeIds.contains(to)) {
        throw invalidBpmn(
            line,
            "Sequence flow '"
                + id
                + "' references a node that is not part of the process ("
                + from
                + " -> "
                + to
                + ").");
      }
      ObjectNode transition = transitions.addObject();
      transition.put("id", id.isBlank() ? "transition-" + index : id);
      transition.put("from", from);
      transition.put("to", to);
      Element condition = firstChild(flow, "conditionExpression");
      if (condition != null) {
        String expression = condition.getTextContent();
        if (expression != null && !expression.isBlank()) {
          transition.put("condition", expression);
        }
      }
      index++;
    }

    return new ImportResult(definition.toString(), List.copyOf(warnings));
  }

  private void appendExtension(
      Document document, Element element, String nodeType, JsonNode config) {
    Element extension = document.createElementNS(BPMN_NS, "bpmn:extensionElements");
    Element typeElement = document.createElementNS(AWAP_NS, "awap:nodeType");
    typeElement.setTextContent(nodeType);
    extension.appendChild(typeElement);
    if (config != null && !config.isNull() && !(config.isObject() && config.isEmpty())) {
      Element configElement = document.createElementNS(AWAP_NS, "awap:config");
      try {
        configElement.setTextContent(objectMapper.writeValueAsString(config));
      } catch (JsonProcessingException ex) {
        throw invalidDefinition("The node config could not be serialized.");
      }
      extension.appendChild(configElement);
    }
    element.appendChild(extension);
  }

  private NodeType nodeType(Element element, String localName, String bpmnXml) {
    String explicit = extensionText(element, "nodeType");
    if (explicit != null && !explicit.isBlank()) {
      try {
        return NodeType.valueOf(explicit.trim());
      } catch (IllegalArgumentException ex) {
        throw invalidBpmn(
            lineOfElement(bpmnXml, element), "Unsupported awap:nodeType '" + explicit + "'.");
      }
    }
    return switch (localName) {
      case "startEvent" -> NodeType.START;
      case "endEvent" -> NodeType.END;
      case "userTask", "manualTask", "task" -> NodeType.TASK;
      case "serviceTask", "scriptTask" -> NodeType.SCRIPT;
      case "sendTask", "receiveTask" -> NodeType.WEBHOOK;
      case "callActivity" -> NodeType.SUB_PROCESS;
      case "exclusiveGateway", "inclusiveGateway" -> NodeType.DECISION;
      case "parallelGateway" -> NodeType.PARALLEL_GATEWAY;
      case "intermediateCatchEvent" -> NodeType.DELAY;
      default ->
          throw invalidBpmn(
              lineOfElement(bpmnXml, element), "Unsupported BPMN element '" + localName + "'.");
    };
  }

  private boolean isNodeElement(String localName) {
    return switch (localName) {
      case "startEvent",
          "endEvent",
          "userTask",
          "manualTask",
          "task",
          "serviceTask",
          "scriptTask",
          "sendTask",
          "receiveTask",
          "callActivity",
          "exclusiveGateway",
          "inclusiveGateway",
          "parallelGateway",
          "intermediateCatchEvent" ->
          true;
      default -> false;
    };
  }

  private JsonNode configOf(Element element, String bpmnXml) {
    String config = extensionText(element, "config");
    if (config == null || config.isBlank()) {
      return null;
    }
    try {
      JsonNode parsed = objectMapper.readTree(config);
      if (!parsed.isObject()) {
        throw invalidBpmn(lineOfElement(bpmnXml, element), "awap:config must be a JSON object.");
      }
      return parsed;
    } catch (JsonProcessingException ex) {
      throw invalidBpmn(lineOfElement(bpmnXml, element), "awap:config is not valid JSON.");
    }
  }

  private String extensionText(Element element, String localName) {
    Element extension = firstChild(element, "extensionElements");
    if (extension == null) {
      return null;
    }
    Element value = firstChild(extension, localName);
    return value == null ? null : value.getTextContent();
  }

  private Document newDocument() {
    try {
      return hardenedFactory().newDocumentBuilder().newDocument();
    } catch (ParserConfigurationException ex) {
      throw new IllegalStateException("The XML document builder is unavailable.", ex);
    }
  }

  private Document parse(String xml) {
    try {
      DocumentBuilder builder = hardenedFactory().newDocumentBuilder();
      builder.setErrorHandler(
          new ErrorHandler() {
            @Override
            public void warning(SAXParseException exception) {
              // Warnings do not make the document invalid.
            }

            @Override
            public void error(SAXParseException exception) throws SAXException {
              throw exception;
            }

            @Override
            public void fatalError(SAXParseException exception) throws SAXException {
              throw exception;
            }
          });
      return builder.parse(new InputSource(new StringReader(xml)));
    } catch (SAXParseException ex) {
      throw invalidBpmn(ex.getLineNumber(), "XML is not well-formed: " + ex.getMessage());
    } catch (SAXException | IOException | ParserConfigurationException ex) {
      throw invalidBpmn(1, "The BPMN document could not be parsed.");
    }
  }

  /**
   * Builds a parser that never resolves a DTD or an external entity. The disallow-doctype feature
   * rejects XXE payloads outright; the access restrictions are a second, independent guard.
   */
  private DocumentBuilderFactory hardenedFactory() throws ParserConfigurationException {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setNamespaceAware(true);
    factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
    factory.setXIncludeAware(false);
    factory.setExpandEntityReferences(false);
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
    return factory;
  }

  private String serialize(Document document) {
    try {
      TransformerFactory factory = TransformerFactory.newInstance();
      factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
      Transformer transformer = factory.newTransformer();
      transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
      transformer.setOutputProperty(OutputKeys.INDENT, "yes");
      transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "no");
      StringWriter writer = new StringWriter();
      transformer.transform(new DOMSource(document), new StreamResult(writer));
      return writer.toString();
    } catch (TransformerException | IllegalArgumentException ex) {
      throw new IllegalStateException("The BPMN document could not be serialized.", ex);
    }
  }

  private String elementName(NodeType type) {
    return switch (type) {
      case START -> "bpmn:startEvent";
      case END -> "bpmn:endEvent";
      case FORM, APPROVAL, TASK -> "bpmn:userTask";
      case DECISION, CONDITION -> "bpmn:exclusiveGateway";
      case PARALLEL, PARALLEL_GATEWAY, MERGE, MERGE_GATEWAY -> "bpmn:parallelGateway";
      case DELAY -> "bpmn:intermediateCatchEvent";
      case WEBHOOK -> "bpmn:sendTask";
      case SUB_PROCESS -> "bpmn:callActivity";
      case AI, AI_TASK -> "bpmn:serviceTask";
      case SCRIPT -> "bpmn:scriptTask";
    };
  }

  private NodeType parseType(String typeName) {
    if (typeName == null || typeName.isBlank()) {
      throw invalidDefinition("Every workflow node needs a type.");
    }
    try {
      return NodeType.valueOf(typeName);
    } catch (IllegalArgumentException ex) {
      throw invalidDefinition("Unsupported workflow node type '" + typeName + "'.");
    }
  }

  private String text(JsonNode node, String field) {
    JsonNode value = node.get(field);
    return value == null || value.isNull() ? null : value.asText();
  }

  private String localName(Node node) {
    String local = node.getLocalName();
    if (local != null) {
      return local;
    }
    String name = node.getNodeName();
    int colon = name.indexOf(':');
    return colon < 0 ? name : name.substring(colon + 1);
  }

  private List<Element> childElements(Element parent) {
    List<Element> elements = new ArrayList<>();
    NodeList children = parent.getChildNodes();
    for (int index = 0; index < children.getLength(); index++) {
      Node child = children.item(index);
      if (child instanceof Element element) {
        elements.add(element);
      }
    }
    return elements;
  }

  private Element firstChild(Element parent, String localName) {
    for (Element child : childElements(parent)) {
      if (localName.equals(localName(child))) {
        return child;
      }
    }
    return null;
  }

  private Element firstDescendant(Element parent, String localName) {
    NodeList descendants = parent.getElementsByTagNameNS("*", localName);
    if (descendants.getLength() > 0) {
      return (Element) descendants.item(0);
    }
    for (Element child : childElements(parent)) {
      if (localName.equals(localName(child))) {
        return child;
      }
    }
    return null;
  }

  private int lineOfElement(String xml, Element element) {
    String id = element.getAttribute("id");
    if (id != null && !id.isBlank()) {
      int line = lineOf(xml, "id=\"" + id + "\"");
      if (line > 0) {
        return line;
      }
    }
    return lineOf(xml, localName(element));
  }

  private int lineOf(String xml, String token) {
    int index = xml.indexOf(token);
    if (index < 0) {
      return 1;
    }
    int line = 1;
    for (int position = 0; position < index; position++) {
      if (xml.charAt(position) == '\n') {
        line++;
      }
    }
    return line;
  }

  private AwapException invalidBpmn(int line, String message) {
    return new AwapException(
        ErrorCode.WORKFLOW_INVALID_DEFINITION,
        HttpStatus.BAD_REQUEST,
        "Invalid BPMN at line " + Math.max(1, line) + ": " + message);
  }

  private AwapException invalidDefinition(String message) {
    return new AwapException(
        ErrorCode.WORKFLOW_INVALID_DEFINITION,
        HttpStatus.BAD_REQUEST,
        "Invalid workflow definition: " + message);
  }
}

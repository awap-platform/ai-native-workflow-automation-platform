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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

/**
 * Minimal BPMN 2.0 import/export for the internal workflow definition JSON.
 *
 * <p>The converter deliberately covers the subset of BPMN that maps onto the engine's node types.
 * The original node type and config are stored in the {@code awap} extension namespace, so a
 * definition survives a round-trip without losing engine-specific settings. Diagram interchange
 * (positions, waypoints and lane/pool ids) is preserved through {@code bpmndi:BPMNDiagram}; when a
 * definition has no DI the exporter generates a deterministic layout and marks it {@code
 * awap:diGenerated}, so a legacy definition still round-trips without gaining geometry.
 *
 * <p>Parsing is hardened against XXE and entity-expansion attacks: DTDs are rejected, external
 * entities and external schema/DTD access are disabled, and secure processing is enabled. XML
 * larger than {@link #MAX_XML_LENGTH} is rejected with 413 before the parser sees it.
 */
@Service
public class BpmnXmlService {

  /** One megabyte is enough for large diagrams while capping parser work per request. */
  public static final int MAX_XML_LENGTH = 1_000_000;

  /** Caps DI work per import so a hostile waypoint array cannot exhaust memory. */
  public static final int MAX_DI_WAYPOINTS = 10_000;

  private static final String BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL";
  private static final String BPMNDI_NS = "http://www.omg.org/spec/BPMN/20100524/DI";
  private static final String DC_NS = "http://www.omg.org/spec/DD/20100524/DC";
  private static final String DI_NS = "http://www.omg.org/spec/DD/20100524/DI";
  private static final String AWAP_NS = "https://awap.dev/schema/bpmn";
  private static final String XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
  private static final double DEFAULT_NODE_WIDTH = 180;
  private static final double DEFAULT_NODE_HEIGHT = 64;

  private final ObjectMapper objectMapper;

  public BpmnXmlService(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  /** Result of an import, including warnings for BPMN constructs that were ignored. */
  public record ImportResult(String definitionJson, List<String> warnings) {}

  /** Transition identity plus the optional DI needed to emit a BPMNEdge. */
  private record TransitionVisual(String id, String from, String to, JsonNode di) {}

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
    definitions.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:bpmndi", BPMNDI_NS);
    definitions.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:dc", DC_NS);
    definitions.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:di", DI_NS);
    definitions.setAttribute("targetNamespace", "https://awap.dev/bpmn");
    document.appendChild(definitions);

    Element process = document.createElementNS(BPMN_NS, "bpmn:process");
    process.setAttribute("id", "workflow");
    process.setAttribute("isExecutable", "true");
    definitions.appendChild(process);

    Set<String> nodeIds = new HashSet<>();
    List<String> nodeOrder = new ArrayList<>();
    Map<String, JsonNode> nodeDi = new LinkedHashMap<>();
    for (JsonNode node : nodes) {
      String id = text(node, "id");
      String typeName = text(node, "type");
      if (id == null || id.isBlank()) {
        throw invalidDefinition("Every workflow node needs an id.");
      }
      if (!nodeIds.add(id)) {
        throw invalidDefinition("Duplicate node id '" + id + "'.");
      }
      nodeOrder.add(id);
      nodeDi.put(id, node.get("di"));
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
    List<TransitionVisual> transitionVisuals = new ArrayList<>();
    if (transitions != null) {
      int index = 0;
      for (JsonNode transition : transitions) {
        String from = text(transition, "from");
        String to = text(transition, "to");
        if (from == null || to == null || !nodeIds.contains(from) || !nodeIds.contains(to)) {
          throw invalidDefinition("Transition endpoints must reference existing nodes.");
        }
        String id = text(transition, "id");
        String flowId = id == null || id.isBlank() ? "transition-" + index : id;
        Element flow = document.createElementNS(BPMN_NS, "bpmn:sequenceFlow");
        flow.setAttribute("id", flowId);
        flow.setAttribute("sourceRef", from);
        flow.setAttribute("targetRef", to);
        transitionVisuals.add(new TransitionVisual(flowId, from, to, transition.get("di")));
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

    appendDiagram(document, definitions, nodeOrder, nodeDi, transitionVisuals);
    return serialize(document);
  }

  /** Emits a BPMN DI diagram for nodes and sequence flows, generating only when DI is absent. */
  private void appendDiagram(
      Document document,
      Element definitions,
      List<String> nodeOrder,
      Map<String, JsonNode> nodeDi,
      List<TransitionVisual> transitions) {
    Element diagram = document.createElementNS(BPMNDI_NS, "bpmndi:BPMNDiagram");
    diagram.setAttribute("id", "BPMNDiagram_workflow");
    Element plane = document.createElementNS(BPMNDI_NS, "bpmndi:BPMNPlane");
    plane.setAttribute("id", "BPMNPlane_workflow");
    plane.setAttribute("bpmnElement", "workflow");
    diagram.appendChild(plane);

    Map<String, double[]> geometry = new LinkedHashMap<>();
    int index = 0;
    for (String id : nodeOrder) {
      JsonNode di = nodeDi.get(id);
      boolean generated = !validNodeDiagram(di);
      double x = generated ? 80 + index * 40d : di.get("x").asDouble();
      double y = generated ? 80 + index * 40d : di.get("y").asDouble();
      double width = generated ? DEFAULT_NODE_WIDTH : di.get("width").asDouble();
      double height = generated ? DEFAULT_NODE_HEIGHT : di.get("height").asDouble();
      geometry.put(id, new double[] {x, y, width, height});

      Element shape = document.createElementNS(BPMNDI_NS, "bpmndi:BPMNShape");
      shape.setAttribute("id", "BPMNShape_" + id);
      shape.setAttribute("bpmnElement", id);
      if (generated) {
        shape.setAttributeNS(AWAP_NS, "awap:diGenerated", "true");
      }
      Element bounds = document.createElementNS(DC_NS, "dc:Bounds");
      bounds.setAttribute("x", formatCoordinate(x));
      bounds.setAttribute("y", formatCoordinate(y));
      bounds.setAttribute("width", formatCoordinate(width));
      bounds.setAttribute("height", formatCoordinate(height));
      shape.appendChild(bounds);
      String laneId = di == null ? null : text(di, "laneId");
      String poolId = di == null ? null : text(di, "poolId");
      if (laneId != null && !laneId.isBlank()) {
        shape.setAttributeNS(AWAP_NS, "awap:laneId", laneId);
      }
      if (poolId != null && !poolId.isBlank()) {
        shape.setAttributeNS(AWAP_NS, "awap:poolId", poolId);
      }
      plane.appendChild(shape);
      index++;
    }

    for (TransitionVisual transition : transitions) {
      JsonNode di = transition.di();
      boolean generated = !validTransitionDiagram(di);
      Element edge = document.createElementNS(BPMNDI_NS, "bpmndi:BPMNEdge");
      edge.setAttribute("id", "BPMNEdge_" + transition.id());
      edge.setAttribute("bpmnElement", transition.id());
      if (generated) {
        edge.setAttributeNS(AWAP_NS, "awap:diGenerated", "true");
      }
      if (!generated) {
        for (JsonNode point : di.get("waypoints")) {
          Element waypoint = document.createElementNS(DI_NS, "di:waypoint");
          waypoint.setAttribute("x", formatCoordinate(point.get("x").asDouble()));
          waypoint.setAttribute("y", formatCoordinate(point.get("y").asDouble()));
          edge.appendChild(waypoint);
        }
        JsonNode label = di.get("labelPosition");
        if (label != null && label.isObject()) {
          Element labelElement = document.createElementNS(BPMNDI_NS, "bpmndi:BPMNLabel");
          Element labelBounds = document.createElementNS(DC_NS, "dc:Bounds");
          labelBounds.setAttribute("x", formatCoordinate(label.get("x").asDouble()));
          labelBounds.setAttribute("y", formatCoordinate(label.get("y").asDouble()));
          labelBounds.setAttribute("width", "0");
          labelBounds.setAttribute("height", "0");
          labelElement.appendChild(labelBounds);
          edge.appendChild(labelElement);
        }
      } else {
        for (JsonNode point : generatedWaypoints(geometry, transition.from(), transition.to())) {
          Element waypoint = document.createElementNS(DI_NS, "di:waypoint");
          waypoint.setAttribute("x", formatCoordinate(point.get("x").asDouble()));
          waypoint.setAttribute("y", formatCoordinate(point.get("y").asDouble()));
          edge.appendChild(waypoint);
        }
      }
      plane.appendChild(edge);
    }
    definitions.appendChild(diagram);
  }

  private List<JsonNode> generatedWaypoints(
      Map<String, double[]> geometry, String from, String to) {
    ObjectMapper mapper = objectMapper;
    double[] source =
        geometry.getOrDefault(from, new double[] {80, 80, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT});
    double[] target =
        geometry.getOrDefault(to, new double[] {240, 240, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT});
    var start = mapper.createObjectNode();
    start.put("x", source[0] + source[2] / 2);
    start.put("y", source[1] + source[3]);
    var end = mapper.createObjectNode();
    end.put("x", target[0] + target[2] / 2);
    end.put("y", target[1]);
    if (from.equals(to) || start.equals(end)) {
      var middle = mapper.createObjectNode();
      middle.put("x", source[0] + source[2] + 20);
      middle.put("y", source[1] + source[3] / 2);
      return List.of(start, middle, end);
    }
    return List.of(start, end);
  }

  private boolean validNodeDiagram(JsonNode di) {
    if (di == null || !di.isObject()) {
      return false;
    }
    return finite(di.get("x"))
        && finite(di.get("y"))
        && finite(di.get("width"))
        && finite(di.get("height"))
        && di.get("width").asDouble() > 0
        && di.get("height").asDouble() > 0;
  }

  private boolean validTransitionDiagram(JsonNode di) {
    if (di == null || !di.isObject() || !di.path("waypoints").isArray()) {
      return false;
    }
    JsonNode waypoints = di.get("waypoints");
    if (waypoints.size() == 0 || waypoints.size() > MAX_DI_WAYPOINTS) {
      return false;
    }
    for (JsonNode point : waypoints) {
      if (!finite(point.get("x")) || !finite(point.get("y"))) {
        return false;
      }
    }
    JsonNode label = di.get("labelPosition");
    return label == null || (finite(label.get("x")) && finite(label.get("y")));
  }

  private boolean finite(JsonNode value) {
    return value != null && value.isNumber() && Double.isFinite(value.asDouble());
  }

  private String formatCoordinate(double value) {
    if (value == Math.rint(value)) {
      return Long.toString((long) value);
    }
    return Double.toString(Math.round(value * 10d) / 10d);
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

    Document document = parse(new InputSource(new StringReader(bpmnXml)));
    Element root = document.getDocumentElement();
    if (root == null || !"definitions".equals(localName(root))) {
      throw invalidBpmn(1, "The root element must be bpmn:definitions.");
    }
    Element process = firstDescendant(root, "process");
    if (process == null) {
      throw invalidBpmn(lineOf(bpmnXml, "process"), "The BPMN document has no process.");
    }
    Map<String, Element> shapes = indexDiagram(root, "BPMNShape");
    Map<String, Element> diagramEdges = indexDiagram(root, "BPMNEdge");
    int[] waypointBudget = {0};

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
      if ("scriptTask".equals(name) && firstChild(element, "script") != null) {
        throw invalidBpmn(
            lineOfElement(bpmnXml, element),
            "Script tasks are not supported; the script body would execute code on import.");
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
      attachNodeDiagram(node, id, shapes.get(id), bpmnXml);
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
      attachTransitionDiagram(transition, id, diagramEdges.get(id), bpmnXml, waypointBudget);
      index++;
    }

    return new ImportResult(definition.toString(), List.copyOf(warnings));
  }

  /** Indexes BPMNShape/BPMNEdge elements by their bpmnElement reference. */
  private Map<String, Element> indexDiagram(Element root, String localName) {
    Map<String, Element> result = new LinkedHashMap<>();
    NodeList elements = root.getElementsByTagNameNS(BPMNDI_NS, localName);
    for (int index = 0; index < elements.getLength(); index++) {
      Element element = (Element) elements.item(index);
      String reference = element.getAttribute("bpmnElement");
      if (reference != null && !reference.isBlank()) {
        result.put(reference, element);
      }
    }
    return result;
  }

  private void attachNodeDiagram(ObjectNode node, String id, Element shape, String bpmnXml) {
    if (shape == null || isGenerated(shape)) {
      return;
    }
    int line = lineOfElement(bpmnXml, shape);
    Element bounds = firstChild(shape, "Bounds");
    if (bounds == null) {
      throw invalidBpmn(line, "BPMNShape '" + id + "' has no dc:Bounds.");
    }
    Double x = numberAttribute(bounds, "x");
    Double y = numberAttribute(bounds, "y");
    Double width = numberAttribute(bounds, "width");
    Double height = numberAttribute(bounds, "height");
    if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) {
      throw invalidBpmn(line, "BPMNShape '" + id + "' has invalid x/y/width/height geometry.");
    }
    ObjectNode di = node.putObject("di");
    di.put("x", x);
    di.put("y", y);
    di.put("width", width);
    di.put("height", height);
    String laneId = awapAttribute(shape, "laneId");
    String poolId = awapAttribute(shape, "poolId");
    if (laneId != null && !laneId.isBlank()) {
      di.put("laneId", laneId);
    }
    if (poolId != null && !poolId.isBlank()) {
      di.put("poolId", poolId);
    }
  }

  private void attachTransitionDiagram(
      ObjectNode transition, String id, Element edge, String bpmnXml, int[] waypointBudget) {
    if (edge == null || isGenerated(edge)) {
      return;
    }
    int line = lineOfElement(bpmnXml, edge);
    List<Element> points = new ArrayList<>();
    for (Element child : childElements(edge)) {
      if ("waypoint".equals(localName(child))) {
        points.add(child);
      }
    }
    if (points.isEmpty()) {
      return;
    }
    if (points.size() > MAX_DI_WAYPOINTS || waypointBudget[0] + points.size() > MAX_DI_WAYPOINTS) {
      throw invalidBpmn(
          line,
          "BPMNEdge '" + id + "' exceeds the waypoint limit of " + MAX_DI_WAYPOINTS + " points.");
    }
    waypointBudget[0] += points.size();
    ArrayNode waypoints = objectMapper.createArrayNode();
    for (Element point : points) {
      Double x = numberAttribute(point, "x");
      Double y = numberAttribute(point, "y");
      if (x == null || y == null) {
        throw invalidBpmn(line, "BPMNEdge '" + id + "' has a waypoint without numeric x/y.");
      }
      ObjectNode waypoint = waypoints.addObject();
      waypoint.put("x", x);
      waypoint.put("y", y);
    }
    ObjectNode di = transition.putObject("di");
    di.set("waypoints", waypoints);
    Element label = firstChild(edge, "BPMNLabel");
    Element labelBounds = label == null ? null : firstChild(label, "Bounds");
    if (labelBounds != null) {
      Double labelX = numberAttribute(labelBounds, "x");
      Double labelY = numberAttribute(labelBounds, "y");
      if (labelX == null || labelY == null) {
        throw invalidBpmn(line, "BPMNEdge '" + id + "' has a label without numeric x/y.");
      }
      ObjectNode labelPosition = di.putObject("labelPosition");
      labelPosition.put("x", labelX);
      labelPosition.put("y", labelY);
    }
  }

  private boolean isGenerated(Element element) {
    String value = element.getAttributeNS(AWAP_NS, "diGenerated");
    if (value == null || value.isBlank()) {
      value = element.getAttribute("awap:diGenerated");
    }
    return "true".equalsIgnoreCase(value);
  }

  private String awapAttribute(Element element, String localName) {
    String value = element.getAttributeNS(AWAP_NS, localName);
    if (value == null || value.isBlank()) {
      value = element.getAttribute("awap:" + localName);
    }
    return value;
  }

  private Double numberAttribute(Element element, String name) {
    String value = element.getAttribute(name);
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      double parsed = Double.parseDouble(value);
      return Double.isFinite(parsed) ? parsed : null;
    } catch (NumberFormatException ex) {
      return null;
    }
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

  NodeType nodeType(Element element, String localName, String bpmnXml) {
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

  Document parse(InputSource source) {
    try {
      DocumentBuilder builder = hardenedFactory().newDocumentBuilder();
      return builder.parse(source);
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
  DocumentBuilderFactory hardenedFactory() throws ParserConfigurationException {
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

  String serialize(Document document) {
    try {
      Transformer transformer = newTransformer();
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

  Transformer newTransformer() throws TransformerException {
    TransformerFactory factory = TransformerFactory.newInstance();
    factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
    return factory.newTransformer();
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
    return node.getLocalName() == null ? node.getNodeName() : node.getLocalName();
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
    return descendants.getLength() > 0 ? (Element) descendants.item(0) : null;
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

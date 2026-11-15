package com.awap.ai.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Versioned JSON-schema contract for the AI_TASK {@code EXTRACT} action (issue #287).
 *
 * <p>The contract is deliberately small and strict: an object root, a non-empty {@code properties}
 * map with explicit types, and an optional {@code required} list. Output is validated before it can
 * reach a downstream node; malformed, partial, unknown or wrongly typed fields fail closed.
 */
public final class AiExtractionSchema {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final Set<String> TYPES =
      Set.of("string", "number", "integer", "boolean", "object", "array");

  private final String version;
  private final Set<String> required;
  private final Map<String, Property> properties;

  private AiExtractionSchema(
      String version, Set<String> required, Map<String, Property> properties) {
    this.version = version;
    this.required = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(required));
    this.properties = Map.copyOf(properties);
  }

  public static AiExtractionSchema parse(String json) {
    if (json == null || json.isBlank()) {
      throw invalid("schema must be provided");
    }
    try {
      JsonNode root = MAPPER.readTree(json);
      if (root == null || !root.isObject()) {
        throw invalid("schema must be a JSON object");
      }
      JsonNode propertiesNode = root.get("properties");
      if (propertiesNode == null || !propertiesNode.isObject() || propertiesNode.isEmpty()) {
        throw invalid("schema.properties must be a non-empty object");
      }
      Map<String, Property> properties = new LinkedHashMap<>();
      Iterator<Map.Entry<String, JsonNode>> fields = propertiesNode.fields();
      while (fields.hasNext()) {
        Map.Entry<String, JsonNode> field = fields.next();
        properties.put(field.getKey(), Property.parse(field.getKey(), field.getValue()));
      }
      Set<String> required = parseRequired(root.get("required"), properties.keySet());
      return new AiExtractionSchema(root.path("version").asText("v1"), required, properties);
    } catch (JsonProcessingException ex) {
      throw invalid("schema is not valid JSON");
    }
  }

  private static Set<String> parseRequired(JsonNode node, Set<String> properties) {
    Set<String> required = new LinkedHashSet<>();
    if (node == null || node.isNull()) {
      return required;
    }
    if (!node.isArray()) {
      throw invalid("schema.required must be an array");
    }
    for (JsonNode value : node) {
      if (!value.isTextual() || !properties.contains(value.asText())) {
        throw invalid("schema.required contains an unknown field");
      }
      required.add(value.asText());
    }
    return required;
  }

  /**
   * Validates a model completion and returns the canonical JSON that may reach downstream nodes.
   */
  public ExtractionResult validateOutput(String output) {
    if (output == null || output.isBlank()) {
      throw invalid("extraction output is empty");
    }
    try {
      JsonNode root = MAPPER.readTree(output);
      if (root == null || !root.isObject()) {
        throw invalid("extraction output must be a JSON object");
      }
      for (String field : required) {
        JsonNode value = root.get(field);
        if (value == null || value.isNull()) {
          throw invalid("required field '" + field + "' is missing");
        }
      }
      Iterator<Map.Entry<String, JsonNode>> fields = root.fields();
      while (fields.hasNext()) {
        Map.Entry<String, JsonNode> field = fields.next();
        Property property = properties.get(field.getKey());
        if (property == null) {
          throw invalid("unknown field '" + field.getKey() + "'");
        }
        property.validate(field.getKey(), field.getValue());
      }
      return new ExtractionResult(MAPPER.writeValueAsString(root), root.size(), version);
    } catch (JsonProcessingException ex) {
      throw invalid("extraction output is not valid JSON");
    }
  }

  public String version() {
    return version;
  }

  public Set<String> required() {
    return required;
  }

  public Map<String, Property> properties() {
    return properties;
  }

  private static AiGuardrailViolationException invalid(String message) {
    return new AiGuardrailViolationException(message);
  }

  /** Result of a successful schema validation. */
  public record ExtractionResult(String json, int fieldCount, String schemaVersion) {}

  /** One property contract. */
  public record Property(String name, String type, Set<String> allowedValues, Integer maxLength) {

    static Property parse(String name, JsonNode node) {
      if (node == null || !node.isObject()) {
        throw invalid("property '" + name + "' must be an object");
      }
      String type = node.path("type").asText("");
      if (!TYPES.contains(type)) {
        throw invalid("property '" + name + "' has an unsupported type");
      }
      Set<String> allowed = new LinkedHashSet<>();
      JsonNode enumNode = node.get("enum");
      if (enumNode != null && !enumNode.isNull()) {
        if (!enumNode.isArray()) {
          throw invalid("property '" + name + "' enum must be an array");
        }
        for (JsonNode value : enumNode) {
          if (!value.isTextual()) {
            throw invalid("property '" + name + "' enum values must be strings");
          }
          allowed.add(value.asText());
        }
      }
      JsonNode maxLength = node.get("maxLength");
      Integer limit = null;
      if (maxLength != null && !maxLength.isNull()) {
        if (!maxLength.canConvertToInt() || maxLength.asInt() < 0) {
          throw invalid("property '" + name + "' maxLength must be a non-negative integer");
        }
        limit = maxLength.asInt();
      }
      return new Property(
          name, type, java.util.Collections.unmodifiableSet(new LinkedHashSet<>(allowed)), limit);
    }

    void validate(String field, JsonNode value) {
      boolean matches =
          switch (type) {
            case "string" -> value.isTextual();
            case "number" -> value.isNumber();
            case "integer" -> value.isIntegralNumber();
            case "boolean" -> value.isBoolean();
            case "object" -> value.isObject();
            case "array" -> value.isArray();
            default -> false;
          };
      if (!matches) {
        throw invalid("field '" + field + "' must be of type " + type);
      }
      if (value.isTextual() && maxLength != null && value.asText().length() > maxLength) {
        throw invalid("field '" + field + "' exceeds maxLength " + maxLength);
      }
      if (value.isTextual()
          && !allowedValues.isEmpty()
          && !allowedValues.contains(value.asText())) {
        throw invalid("field '" + field + "' is not one of " + allowedValues);
      }
    }
  }
}

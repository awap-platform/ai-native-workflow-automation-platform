package com.awap.form.application;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Schema rules shared by schema validation and submission validation: conditional visibility,
 * calculation dependencies and the cycle check.
 *
 * <p>These mirror {@code frontend/lib/forms/schema.ts}. A field hidden by its rule is neither
 * required nor validated, and a calculated field's submitted value must match the value recomputed
 * from the other submitted values, so a client that skips the frontend rules cannot store a
 * tampered calculation.
 */
final class FormRules {

  private FormRules() {}

  /** String view of a JSON value, used for condition comparisons and calculations. */
  static String textOf(JsonNode node) {
    if (node == null || node.isNull() || node.isMissingNode()) {
      return "";
    }
    if (node.isTextual()) {
      return node.asText();
    }
    if (node.isNumber() || node.isBoolean()) {
      return node.asText();
    }
    if (node.isArray()) {
      List<String> parts = new ArrayList<>();
      for (JsonNode item : node) {
        parts.add(textOf(item));
      }
      return String.join(",", parts);
    }
    return "";
  }

  /** Every scalar value of the submission as a string map, for the expression evaluator. */
  static Map<String, String> valuesOf(JsonNode data) {
    Map<String, String> values = new HashMap<>();
    if (data == null || !data.isObject()) {
      return values;
    }
    data.properties()
        .forEach(
            entry -> {
              JsonNode value = entry.getValue();
              if (value == null || value.isNull() || value.isContainerNode()) {
                return;
              }
              values.put(entry.getKey(), textOf(value));
            });
    return values;
  }

  /** True when the field has no condition or its condition matches the submitted values. */
  static boolean isVisible(JsonNode field, JsonNode data) {
    JsonNode rule = field.get("visibleWhen");
    if (rule == null || rule.isNull() || !rule.isObject()) {
      return true;
    }
    String fieldId = rule.path("fieldId").asText("");
    String operator = rule.path("operator").asText("");
    String expected = rule.path("value").asText("");
    String current = textOf(data == null ? null : data.get(fieldId));
    return switch (operator) {
      case "EQUALS" -> current.equals(expected);
      case "NOT_EQUALS" -> !current.equals(expected);
      case "CONTAINS" -> current.contains(expected);
      case "GREATER_THAN" -> greaterThan(current, expected);
      case "LESS_THAN" -> lessThan(current, expected);
      case "IS_EMPTY" -> current.isBlank();
      case "IS_NOT_EMPTY" -> !current.isBlank();
      default -> true;
    };
  }

  private static boolean greaterThan(String left, String right) {
    Integer comparison = compare(left, right);
    return comparison != null && comparison > 0;
  }

  private static boolean lessThan(String left, String right) {
    Integer comparison = compare(left, right);
    return comparison != null && comparison < 0;
  }

  /** Numeric comparison, or {@code null} when either side is not a number. */
  private static Integer compare(String left, String right) {
    if (left.isBlank() || right.isBlank()) {
      return null;
    }
    try {
      return Double.compare(Double.parseDouble(left.trim()), Double.parseDouble(right.trim()));
    } catch (NumberFormatException ex) {
      return null;
    }
  }

  /** Calculated field id → ids it reads. */
  static Map<String, List<String>> calculationDependencies(JsonNode fields) {
    Map<String, List<String>> dependencies = new LinkedHashMap<>();
    if (fields == null || !fields.isArray()) {
      return dependencies;
    }
    for (JsonNode field : fields) {
      JsonNode expression = field.get("calculated");
      if (expression == null || !expression.isTextual() || expression.asText().isBlank()) {
        continue;
      }
      String id = field.path("id").asText("");
      dependencies.put(id, FormExpressions.dependencies(expression.asText()));
    }
    return dependencies;
  }

  /** Returns the cycle as an ordered id list (first id repeated) or {@code null}. */
  static List<String> calculationCycle(JsonNode fields) {
    Map<String, List<String>> dependencies = calculationDependencies(fields);
    if (dependencies.isEmpty()) {
      return null;
    }
    Set<String> visited = new HashSet<>();
    Set<String> visiting = new LinkedHashSet<>();
    List<String> path = new ArrayList<>();
    for (String id : dependencies.keySet()) {
      List<String> cycle = visit(id, dependencies, visited, visiting, path);
      if (cycle != null) {
        return cycle;
      }
    }
    return null;
  }

  private static List<String> visit(
      String id,
      Map<String, List<String>> dependencies,
      Set<String> visited,
      Set<String> visiting,
      List<String> path) {
    if (visited.contains(id)) {
      return null;
    }
    if (visiting.contains(id)) {
      List<String> cycle = new ArrayList<>();
      int start = path.indexOf(id);
      cycle.addAll(path.subList(Math.max(start, 0), path.size()));
      cycle.add(id);
      return cycle;
    }
    visiting.add(id);
    path.add(id);
    for (String dependency : dependencies.getOrDefault(id, List.of())) {
      if (!dependencies.containsKey(dependency)) {
        continue;
      }
      List<String> cycle = visit(dependency, dependencies, visited, visiting, path);
      if (cycle != null) {
        return cycle;
      }
    }
    path.remove(path.size() - 1);
    visiting.remove(id);
    visited.add(id);
    return null;
  }
}

package com.awap.form.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Shared schema rules: value projection, conditional visibility and calculation cycles. */
class FormRulesTest {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private static JsonNode json(String source) {
    try {
      return MAPPER.readTree(source);
    } catch (Exception ex) {
      throw new IllegalStateException(ex);
    }
  }

  private static JsonNode field(String id, String rule) {
    return json("{\"id\":\"" + id + "\",\"type\":\"TEXT\",\"visibleWhen\":" + rule + "}");
  }

  @Test
  void textOfProjectsEveryScalarAndMissingKind() {
    assertThat(FormRules.textOf(null)).isEmpty();
    assertThat(FormRules.textOf(json("null"))).isEmpty();
    assertThat(FormRules.textOf(json("\"Ada\""))).isEqualTo("Ada");
    assertThat(FormRules.textOf(json("12.5"))).isEqualTo("12.5");
    assertThat(FormRules.textOf(json("true"))).isEqualTo("true");
    assertThat(FormRules.textOf(json("[\"a\",\"b\"]"))).isEqualTo("a,b");
    assertThat(FormRules.textOf(json("{\"a\":1}"))).isEmpty();
  }

  @Test
  void valuesOfKeepsOnlyScalars() {
    Map<String, String> values =
        FormRules.valuesOf(json("{\"a\":\"x\",\"b\":2,\"c\":null,\"d\":{}}"));
    assertThat(values).containsOnlyKeys("a", "b");
    assertThat(FormRules.valuesOf(null)).isEmpty();
    assertThat(FormRules.valuesOf(json("[]"))).isEmpty();
  }

  @Test
  void evaluatesEveryConditionOperator() {
    JsonNode data = json("{\"tier\":\"Gold\",\"units\":\"3\"}");
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"tier\",\"operator\":\"EQUALS\",\"value\":\"Gold\"}"),
                data))
        .isTrue();
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"tier\",\"operator\":\"NOT_EQUALS\",\"value\":\"Gold\"}"),
                data))
        .isFalse();
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"tier\",\"operator\":\"CONTAINS\",\"value\":\"ol\"}"),
                data))
        .isTrue();
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"units\",\"operator\":\"GREATER_THAN\",\"value\":\"2\"}"),
                data))
        .isTrue();
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"units\",\"operator\":\"LESS_THAN\",\"value\":\"2\"}"),
                data))
        .isFalse();
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"missing\",\"operator\":\"IS_EMPTY\"}"), data))
        .isTrue();
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"tier\",\"operator\":\"IS_NOT_EMPTY\"}"), data))
        .isTrue();
    assertThat(
            FormRules.isVisible(field("x", "{\"fieldId\":\"tier\",\"operator\":\"NOPE\"}"), data))
        .isTrue();
    assertThat(FormRules.isVisible(json("{\"id\":\"x\",\"type\":\"TEXT\"}"), data)).isTrue();
    assertThat(FormRules.isVisible(field("x", "null"), data)).isTrue();
  }

  @Test
  void nonNumericComparisonsDoNotShowTheField() {
    JsonNode data = json("{\"tier\":\"Gold\"}");
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"tier\",\"operator\":\"GREATER_THAN\",\"value\":\"2\"}"),
                data))
        .isFalse();
    assertThat(
            FormRules.isVisible(
                field("x", "{\"fieldId\":\"tier\",\"operator\":\"LESS_THAN\",\"value\":\"\"}"),
                data))
        .isFalse();
  }

  @Test
  void detectsCyclesIncludingSelfReferences() {
    JsonNode fields =
        json(
            "[{\"id\":\"a\",\"type\":\"NUMBER\",\"calculated\":\"b + 1\"},"
                + "{\"id\":\"b\",\"type\":\"NUMBER\",\"calculated\":\"a + 1\"}]");
    assertThat(FormRules.calculationCycle(fields)).containsExactly("a", "b", "a");

    JsonNode self = json("[{\"id\":\"a\",\"type\":\"NUMBER\",\"calculated\":\"a + 1\"}]");
    assertThat(FormRules.calculationCycle(self)).containsExactly("a", "a");

    JsonNode acyclic =
        json(
            "[{\"id\":\"a\",\"type\":\"NUMBER\"},"
                + "{\"id\":\"b\",\"type\":\"NUMBER\",\"calculated\":\"a * 2\"}]");
    assertThat(FormRules.calculationCycle(acyclic)).isNull();
    assertThat(FormRules.calculationDependencies(acyclic)).containsOnlyKeys("b");
    assertThat(FormRules.calculationCycle(null)).isNull();
    assertThat(FormRules.calculationDependencies(json("{}"))).isEmpty();
  }

  @Test
  void ignoresNonCalculatedAndBlankExpressions() {
    JsonNode fields =
        json(
            "[{\"id\":\"a\",\"type\":\"NUMBER\",\"calculated\":\"  \"},"
                + "{\"id\":\"b\",\"type\":\"NUMBER\",\"calculated\":3}]");
    assertThat(FormRules.calculationDependencies(fields)).isEmpty();
    assertThat(FormRules.calculationCycle(fields)).isNull();
    assertThat(FormRules.calculationDependencies(json("[]"))).isEmpty();
  }
}

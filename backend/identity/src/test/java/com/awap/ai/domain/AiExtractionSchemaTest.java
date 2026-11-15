package com.awap.ai.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class AiExtractionSchemaTest {

  private static final String SCHEMA =
      """
      {
        "version": "v2",
        "required": ["vendor", "amount"],
        "properties": {
          "vendor": {"type": "string", "maxLength": 20},
          "amount": {"type": "number"},
          "count": {"type": "integer"},
          "paid": {"type": "boolean"},
          "meta": {"type": "object"},
          "lines": {"type": "array"},
          "category": {"type": "string", "enum": ["INVOICE", "RECEIPT"]}
        }
      }
      """;

  @Test
  void parsesAValidContract() {
    AiExtractionSchema schema = AiExtractionSchema.parse(SCHEMA);

    assertThat(schema.version()).isEqualTo("v2");
    assertThat(schema.required()).containsExactly("vendor", "amount");
    assertThat(schema.properties()).containsKeys("vendor", "amount", "category");
    assertThat(schema.properties().get("vendor").type()).isEqualTo("string");
    assertThat(schema.properties().get("vendor").maxLength()).isEqualTo(20);
    assertThat(schema.properties().get("category").allowedValues())
        .containsExactly("INVOICE", "RECEIPT");
  }

  @Test
  void validatesEverySupportedTypeAndReturnsCanonicalJson() {
    AiExtractionSchema schema = AiExtractionSchema.parse(SCHEMA);

    AiExtractionSchema.ExtractionResult result =
        schema.validateOutput(
            """
            {"vendor":"Acme","amount":12.5,"count":3,"paid":true,
             "meta":{"a":1},"lines":[1,2],"category":"INVOICE"}
            """);

    assertThat(result.fieldCount()).isEqualTo(7);
    assertThat(result.schemaVersion()).isEqualTo("v2");
    assertThat(result.json()).contains("\"vendor\":\"Acme\"").doesNotContain("\n");
  }

  @Test
  void rejectsMissingRequiredFieldsWrongTypesUnknownFieldsAndInvalidJson() {
    AiExtractionSchema schema = AiExtractionSchema.parse(SCHEMA);

    assertInvalid(schema, "{\"vendor\":\"Acme\"}");
    assertInvalid(schema, "{\"vendor\":1,\"amount\":2}");
    assertInvalid(schema, "{\"vendor\":\"Acme\",\"amount\":\"many\"}");
    assertInvalid(schema, "{\"vendor\":\"Acme\",\"amount\":1,\"count\":1.5}");
    assertInvalid(schema, "{\"vendor\":\"Acme\",\"amount\":1,\"paid\":\"yes\"}");
    assertInvalid(schema, "{\"vendor\":\"Acme\",\"amount\":1,\"meta\":[]}");
    assertInvalid(schema, "{\"vendor\":\"Acme\",\"amount\":1,\"lines\":{}}");
    assertInvalid(schema, "{\"vendor\":\"Acme\",\"amount\":1,\"unknown\":true}");
    assertInvalid(schema, "not-json");
    assertInvalid(schema, "[]");
  }

  @Test
  void enforcesMaxLengthAndAllowedValues() {
    AiExtractionSchema schema = AiExtractionSchema.parse(SCHEMA);

    assertInvalid(schema, "{\"vendor\":\"a-very-long-vendor-name\",\"amount\":1}");
    assertInvalid(schema, "{\"vendor\":\"Acme\",\"amount\":1,\"category\":\"OTHER\"}");
  }

  @Test
  void rejectsNullOrBlankOutput() {
    AiExtractionSchema schema = AiExtractionSchema.parse(SCHEMA);

    assertThatThrownBy(() -> schema.validateOutput(null))
        .isInstanceOf(AiGuardrailViolationException.class);
    assertThatThrownBy(() -> schema.validateOutput("  "))
        .isInstanceOf(AiGuardrailViolationException.class);
  }

  @Test
  void rejectsMalformedSchemaDefinitions() {
    assertInvalidSchema(null);
    assertInvalidSchema(" ");
    assertInvalidSchema("[]");
    assertInvalidSchema("{\"properties\":{}}");
    assertInvalidSchema("{\"properties\":[]}");
    assertInvalidSchema("{\"properties\":{\"a\":\"string\"}}");
    assertInvalidSchema("{\"properties\":{\"a\":{\"type\":\"date\"}}}");
    assertInvalidSchema("{\"properties\":{\"a\":{\"type\":\"string\",\"enum\":\"x\"}}}");
    assertInvalidSchema("{\"properties\":{\"a\":{\"type\":\"string\",\"enum\":[1]}}}");
    assertInvalidSchema("{\"properties\":{\"a\":{\"type\":\"string\",\"maxLength\":-1}}}");
    assertInvalidSchema("{\"properties\":{\"a\":{\"type\":\"string\",\"maxLength\":\"many\"}}}");
    assertInvalidSchema("{\"properties\":{\"a\":{\"type\":\"string\"}},\"required\":\"a\"}");
    assertInvalidSchema("{\"properties\":{\"a\":{\"type\":\"string\"}},\"required\":[\"b\"]}");
    assertInvalidSchema("not-json");
  }

  @Test
  void optionalFieldsMayBeAbsentAndRequiredMayBeOmitted() {
    AiExtractionSchema schema = AiExtractionSchema.parse(SCHEMA);

    AiExtractionSchema.ExtractionResult result =
        schema.validateOutput("{\"vendor\":\"Acme\",\"amount\":1}");

    assertThat(result.fieldCount()).isEqualTo(2);

    AiExtractionSchema noRequired =
        AiExtractionSchema.parse("{\"properties\":{\"a\":{\"type\":\"string\"}}}");
    assertThat(noRequired.required()).isEmpty();
    assertThat(noRequired.validateOutput("{}").fieldCount()).isZero();
  }

  @Test
  void anUnknownPropertyTypeFailsClosedWhenValidated() {
    AiExtractionSchema.Property property =
        new AiExtractionSchema.Property("x", "date", java.util.Set.of(), null);

    assertThatThrownBy(
            () -> property.validate("x", com.fasterxml.jackson.databind.node.TextNode.valueOf("v")))
        .isInstanceOf(AiGuardrailViolationException.class);
  }

  private static void assertInvalid(AiExtractionSchema schema, String output) {
    assertThatThrownBy(() -> schema.validateOutput(output))
        .isInstanceOf(AiGuardrailViolationException.class);
  }

  private static void assertInvalidSchema(String schema) {
    assertThatThrownBy(() -> AiExtractionSchema.parse(schema))
        .isInstanceOf(AiGuardrailViolationException.class);
  }
}

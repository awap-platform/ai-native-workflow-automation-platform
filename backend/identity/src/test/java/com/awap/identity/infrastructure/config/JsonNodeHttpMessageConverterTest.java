package com.awap.identity.infrastructure.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.http.MockHttpOutputMessage;

class JsonNodeHttpMessageConverterTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final JsonNodeHttpMessageConverter converter =
      new JsonNodeHttpMessageConverter(objectMapper);

  @Test
  void onlySupportsJsonNodeTypes() {
    assertThat(converter.canRead(JsonNode.class, MediaType.APPLICATION_JSON)).isTrue();
    assertThat(
            converter.canRead(
                com.fasterxml.jackson.databind.node.ObjectNode.class, MediaType.APPLICATION_JSON))
        .isTrue();
    assertThat(converter.canRead(String.class, MediaType.APPLICATION_JSON)).isFalse();
    assertThat(converter.canRead(JsonNode.class, MediaType.TEXT_PLAIN)).isFalse();
  }

  @Test
  void readsAJsonTree() throws Exception {
    JsonNode node =
        converter.read(
            JsonNode.class,
            input("{\"message\":\"start\",\"nested\":{\"ok\":true}}", MediaType.APPLICATION_JSON));

    assertThat(node.path("message").asText()).isEqualTo("start");
    assertThat(node.path("nested").path("ok").asBoolean()).isTrue();
  }

  @Test
  void writesAJsonTree() throws Exception {
    MockHttpOutputMessage output = new MockHttpOutputMessage();
    JsonNode node = objectMapper.readTree("{\"message\":\"start\"}");

    converter.write(node, MediaType.APPLICATION_JSON, output);

    assertThat(output.getBodyAsString()).contains("start");
  }

  @Test
  void rejectsAMalformedJsonBody() {
    assertThatThrownBy(
            () -> converter.read(JsonNode.class, input("{not-json", MediaType.APPLICATION_JSON)))
        .isInstanceOf(HttpMessageNotReadableException.class)
        .hasMessageContaining("Could not read a JSON tree");
  }

  private static HttpInputMessage input(String body, MediaType contentType) {
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(contentType);
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    return new HttpInputMessage() {
      @Override
      public java.io.InputStream getBody() {
        return new ByteArrayInputStream(bytes);
      }

      @Override
      public HttpHeaders getHeaders() {
        return headers;
      }
    };
  }
}

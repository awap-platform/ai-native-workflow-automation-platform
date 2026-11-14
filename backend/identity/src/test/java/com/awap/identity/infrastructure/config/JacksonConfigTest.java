package com.awap.identity.infrastructure.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class JacksonConfigTest {

  @Test
  void readsAndWritesJsonNode() throws Exception {
    ObjectMapper mapper = new JacksonConfig().objectMapper();

    JsonNode node =
        mapper.readValue(
            "{\"message\":\"start\"}".getBytes(StandardCharsets.UTF_8), JsonNode.class);

    assertThat(node.path("message").asText()).isEqualTo("start");
    assertThat(mapper.writeValueAsString(node)).contains("start");
  }
}

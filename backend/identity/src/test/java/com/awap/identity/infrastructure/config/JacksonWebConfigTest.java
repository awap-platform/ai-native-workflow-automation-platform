package com.awap.identity.infrastructure.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.HttpMessageConverter;

class JacksonWebConfigTest {

  @Test
  void registersTheNarrowJsonNodeConverterBeforeTheDefaults() {
    List<HttpMessageConverter<?>> converters = new ArrayList<>();

    new JacksonWebConfig(new ObjectMapper()).extendMessageConverters(converters);

    assertThat(converters).hasSize(1);
    assertThat(converters.get(0)).isInstanceOf(JsonNodeHttpMessageConverter.class);
  }
}

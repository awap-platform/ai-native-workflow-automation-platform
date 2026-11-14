package com.awap.identity.infrastructure.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;

class JacksonWebConfigTest {

  @Test
  void registersTheJackson2ConverterBeforeTheDefaults() {
    List<HttpMessageConverter<?>> converters = new ArrayList<>();

    new JacksonWebConfig(new ObjectMapper()).extendMessageConverters(converters);

    assertThat(converters).hasSize(1);
    assertThat(converters.get(0)).isInstanceOf(MappingJackson2HttpMessageConverter.class);
  }
}

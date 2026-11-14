package com.awap.identity.infrastructure.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers a Jackson 2 converter for {@code JsonNode} bodies before the Spring Boot 4 default.
 *
 * <p>The converter is intentionally narrow: it only handles Jackson 2 {@code JsonNode} subtypes, so
 * every other DTO keeps the default Jackson 3 serialization. This keeps the Copilot proxy and the
 * internal tool API working without changing the Pact-verified or webhook-delivery contracts.
 */
@Configuration
public class JacksonWebConfig implements WebMvcConfigurer {

  private final ObjectMapper objectMapper;

  public JacksonWebConfig(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  @Override
  public void extendMessageConverters(List<HttpMessageConverter<?>> converters) {
    converters.add(0, new JsonNodeHttpMessageConverter(objectMapper));
  }
}

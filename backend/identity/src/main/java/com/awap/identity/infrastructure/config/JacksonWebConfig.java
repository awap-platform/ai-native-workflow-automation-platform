package com.awap.identity.infrastructure.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Makes Spring MVC use the application's Jackson 2 {@link ObjectMapper}.
 *
 * <p>Spring Boot 4 registers a Jackson 3 converter by default, while the platform, its DTOs and its
 * controllers use Jackson 2 types such as {@code com.fasterxml.jackson.databind.JsonNode}. Without
 * this converter the Jackson 3 converter treats a Jackson 2 {@code JsonNode} parameter as a POJO
 * and fails with “no Creators”. Registering the Jackson 2 converter first keeps request parsing and
 * response serialization aligned with the rest of the backend.
 */
@Configuration
public class JacksonWebConfig implements WebMvcConfigurer {

  private final ObjectMapper objectMapper;

  public JacksonWebConfig(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  @Override
  public void extendMessageConverters(List<HttpMessageConverter<?>> converters) {
    converters.add(0, new MappingJackson2HttpMessageConverter(objectMapper));
  }
}

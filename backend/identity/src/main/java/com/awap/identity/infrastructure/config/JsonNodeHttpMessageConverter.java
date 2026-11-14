package com.awap.identity.infrastructure.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.HttpOutputMessage;
import org.springframework.http.MediaType;
import org.springframework.http.converter.AbstractHttpMessageConverter;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.converter.HttpMessageNotWritableException;

/**
 * Jackson 2 converter scoped to {@link JsonNode} request and response bodies.
 *
 * <p>Spring Boot 4 registers a Jackson 3 converter by default, while the platform and its
 * controllers use Jackson 2 types. Without this converter the Jackson 3 converter treats a Jackson
 * 2 {@code JsonNode} parameter as a POJO. Because this converter only {@code supports} {@code
 * JsonNode} subtypes, every other DTO keeps the default converter's serialization (including the
 * Pact provider contracts and the webhook-delivery responses).
 */
public class JsonNodeHttpMessageConverter extends AbstractHttpMessageConverter<JsonNode> {

  private final ObjectMapper objectMapper;

  public JsonNodeHttpMessageConverter(ObjectMapper objectMapper) {
    super(MediaType.APPLICATION_JSON, new MediaType("application", "*+json"));
    this.objectMapper = objectMapper;
  }

  @Override
  protected boolean supports(Class<?> clazz) {
    return JsonNode.class.isAssignableFrom(clazz);
  }

  @Override
  protected JsonNode readInternal(Class<? extends JsonNode> clazz, HttpInputMessage inputMessage)
      throws IOException, HttpMessageNotReadableException {
    try {
      return objectMapper.readTree(inputMessage.getBody());
    } catch (IOException ex) {
      throw new HttpMessageNotReadableException(
          "Could not read a JSON tree from the request body", ex, inputMessage);
    }
  }

  @Override
  protected void writeInternal(JsonNode node, HttpOutputMessage outputMessage)
      throws IOException, HttpMessageNotWritableException {
    try {
      objectMapper.writeValue(outputMessage.getBody(), node);
    } catch (IOException ex) {
      throw new HttpMessageNotWritableException("Could not write the JSON tree", ex);
    }
  }
}

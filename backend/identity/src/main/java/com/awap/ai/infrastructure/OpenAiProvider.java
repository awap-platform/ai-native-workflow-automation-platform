package com.awap.ai.infrastructure;

import com.awap.ai.application.AiCapability;
import com.awap.ai.domain.AiModelRouter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.EnumSet;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** OpenAI-compatible provider adapter. The wire format is isolated behind the SPI. */
@Component
@ConditionalOnProperty(name = "awap.ai.providers.openai.enabled", havingValue = "true")
public class OpenAiProvider extends AbstractHttpAiProvider {

  @Autowired
  public OpenAiProvider(
      @Value("${awap.ai.providers.openai.base-url:https://api.openai.com/v1}") String baseUrl,
      @Value("${awap.ai.providers.openai.api-key:}") String apiKey,
      @Value("${awap.ai.providers.openai.model:gpt-4o-mini}") String model,
      @Value("${awap.ai.providers.openai.cost-micros-per-token:2}") long costMicrosPerToken,
      @Value("${awap.ai.providers.openai.timeout-ms:5000}") long timeoutMs,
      ObjectMapper objectMapper) {
    this(
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(Math.min(Math.max(timeoutMs, 1), 2_000)))
            .build(),
        objectMapper,
        baseUrl,
        apiKey,
        model,
        costMicrosPerToken,
        timeoutMs);
  }

  public OpenAiProvider(
      HttpClient client,
      ObjectMapper objectMapper,
      String baseUrl,
      String apiKey,
      String model,
      long costMicrosPerToken,
      long timeoutMs) {
    super(client, objectMapper, baseUrl, apiKey, model, costMicrosPerToken, 5_000L, timeoutMs);
  }

  @Override
  public String id() {
    return "openai";
  }

  @Override
  protected String path() {
    return "/chat/completions";
  }

  @Override
  protected void headers(HttpRequest.Builder builder) {
    builder.header("Authorization", "Bearer " + apiKey);
  }

  @Override
  protected String content(JsonNode root) {
    return root.path("choices").path(0).path("message").path("content").asText("");
  }

  @Override
  protected AiModelRouter.Tier tier() {
    return AiModelRouter.Tier.STANDARD;
  }

  @Override
  protected Set<AiCapability> capabilities() {
    return EnumSet.allOf(AiCapability.class);
  }
}

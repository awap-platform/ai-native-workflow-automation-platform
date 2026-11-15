package com.awap.ai.infrastructure;

import com.awap.ai.application.AiCapability;
import com.awap.ai.application.AiProviderRequest;
import com.awap.ai.domain.AiModelRouter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.EnumSet;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Anthropic Messages API adapter (the second external vendor, issue #292). */
@Component
@ConditionalOnProperty(name = "awap.ai.providers.anthropic.enabled", havingValue = "true")
public class AnthropicProvider extends AbstractHttpAiProvider {

  private static final String ANTHROPIC_VERSION = "2023-06-01";

  @Autowired
  public AnthropicProvider(
      @Value("${awap.ai.providers.anthropic.base-url:https://api.anthropic.com}") String baseUrl,
      @Value("${awap.ai.providers.anthropic.api-key:}") String apiKey,
      @Value("${awap.ai.providers.anthropic.model:claude-3-5-haiku-latest}") String model,
      @Value("${awap.ai.providers.anthropic.cost-micros-per-token:1}") long costMicrosPerToken,
      @Value("${awap.ai.providers.anthropic.timeout-ms:5000}") long timeoutMs,
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

  public AnthropicProvider(
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
    return "anthropic";
  }

  @Override
  protected String path() {
    return "/v1/messages";
  }

  @Override
  protected ObjectNode payload(AiProviderRequest request, String selectedModel) {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("model", selectedModel);
    root.put("max_tokens", request.maxTokens());
    ArrayNode messages = root.putArray("messages");
    messages.addObject().put("role", "user").put("content", request.prompt());
    return root;
  }

  @Override
  protected void headers(HttpRequest.Builder builder) {
    builder.header("x-api-key", apiKey).header("anthropic-version", ANTHROPIC_VERSION);
  }

  @Override
  protected String content(JsonNode root) {
    return root.path("content").path(0).path("text").asText("");
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

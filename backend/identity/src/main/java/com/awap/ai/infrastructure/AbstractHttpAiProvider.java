package com.awap.ai.infrastructure;

import com.awap.ai.application.AiCapability;
import com.awap.ai.application.AiModel;
import com.awap.ai.application.AiProvider;
import com.awap.ai.application.AiProviderException;
import com.awap.ai.application.AiProviderRequest;
import com.awap.ai.domain.AiModelRouter;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.List;
import java.util.Set;

/** Shared HTTP plumbing for external providers; vendor specifics are the abstract hooks. */
abstract class AbstractHttpAiProvider implements AiProvider {

  protected final HttpClient client;
  protected final ObjectMapper objectMapper;
  protected final String baseUrl;
  protected final String apiKey;
  protected final String model;
  protected final long costMicrosPerToken;
  protected final long latencyBudgetMs;
  protected final long timeoutMs;

  protected AbstractHttpAiProvider(
      HttpClient client,
      ObjectMapper objectMapper,
      String baseUrl,
      String apiKey,
      String model,
      long costMicrosPerToken,
      long latencyBudgetMs,
      long timeoutMs) {
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalArgumentException(
          "An API key is required for " + getClass().getSimpleName());
    }
    this.client = client;
    this.objectMapper = objectMapper;
    this.baseUrl = normalize(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.costMicrosPerToken = costMicrosPerToken;
    this.latencyBudgetMs = latencyBudgetMs;
    this.timeoutMs = Math.max(1L, timeoutMs);
  }

  protected abstract String path();

  protected abstract ObjectNode payload(AiProviderRequest request, String selectedModel);

  protected abstract void headers(HttpRequest.Builder builder);

  protected abstract String content(JsonNode root);

  protected abstract AiModelRouter.Tier tier();

  protected abstract Set<AiCapability> capabilities();

  @Override
  public List<AiModel> models() {
    return List.of(new AiModel(model, tier(), capabilities(), costMicrosPerToken, latencyBudgetMs));
  }

  @Override
  public boolean healthy() {
    return true;
  }

  @Override
  public String complete(AiProviderRequest request) {
    String selectedModel =
        request.model() == null || request.model().isBlank() ? model : request.model();
    try {
      HttpRequest.Builder builder =
          HttpRequest.newBuilder(URI.create(baseUrl + path()))
              .timeout(Duration.ofMillis(timeoutMs))
              .header("Content-Type", "application/json")
              .POST(
                  HttpRequest.BodyPublishers.ofString(payload(request, selectedModel).toString()));
      headers(builder);
      HttpResponse<String> response =
          client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() == 429) {
        throw new AiProviderException(
            AiProviderException.Code.RATE_LIMITED, true, "Provider rate limit reached.");
      }
      if (response.statusCode() >= 500) {
        throw new AiProviderException(
            AiProviderException.Code.UNAVAILABLE, true, "Provider is unavailable.");
      }
      if (response.statusCode() == 401 || response.statusCode() == 403) {
        throw new AiProviderException(
            AiProviderException.Code.AUTHENTICATION, false, "Provider rejected the credential.");
      }
      if (response.statusCode() / 100 != 2) {
        throw new AiProviderException(
            AiProviderException.Code.INVALID_REQUEST, false, "Provider rejected the request.");
      }
      JsonNode root = objectMapper.readTree(response.body());
      String text = content(root);
      if (text == null || text.isBlank()) {
        throw new AiProviderException(
            AiProviderException.Code.EMPTY_CONTENT, true, "Provider returned empty content.");
      }
      return text;
    } catch (HttpTimeoutException ex) {
      throw new AiProviderException(
          AiProviderException.Code.TIMEOUT, true, "Provider timed out.", ex);
    } catch (JsonProcessingException ex) {
      throw new AiProviderException(
          AiProviderException.Code.MALFORMED_RESPONSE,
          true,
          "Provider returned malformed JSON.",
          ex);
    } catch (IOException ex) {
      throw new AiProviderException(
          AiProviderException.Code.UNAVAILABLE, true, "Provider transport failed.", ex);
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new AiProviderException(
          AiProviderException.Code.UNAVAILABLE, true, "Provider call was interrupted.", ex);
    }
  }

  private static String normalize(String value) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException("A provider base URL is required.");
    }
    return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
  }
}

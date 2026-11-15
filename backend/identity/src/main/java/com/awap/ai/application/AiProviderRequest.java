package com.awap.ai.application;

/** Normalized request passed to every provider adapter. */
public record AiProviderRequest(
    String prompt, int maxTokens, String model, AiCapability capability) {

  public AiProviderRequest {
    if (prompt == null || prompt.isBlank()) {
      throw new IllegalArgumentException("prompt is required");
    }
    if (maxTokens <= 0) {
      throw new IllegalArgumentException("maxTokens must be positive");
    }
    if (capability == null) {
      throw new IllegalArgumentException("capability is required");
    }
  }
}

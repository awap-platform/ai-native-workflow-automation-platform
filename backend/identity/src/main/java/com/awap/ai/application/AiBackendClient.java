package com.awap.ai.application;

/** Secure backend seam for the AI module (ADR-003). */
public interface AiBackendClient {

  /** Runs a prompt and returns the completion. Blocks until done; timeout is enforced by caller. */
  String complete(String prompt, int maxTokens);

  /**
   * Runs a prompt against the model selected by the policy router. Implementations that do not
   * support model selection delegate to {@link #complete(String, int)}.
   */
  default String complete(String prompt, int maxTokens, String model) {
    return complete(prompt, maxTokens);
  }
}

package com.awap.ai.application;

import com.awap.ai.domain.AiModelRouter;
import java.util.EnumSet;
import java.util.Set;

/**
 * Normalized model catalogue entry (issue #292).
 *
 * <p>Costs are micro-dollars per 1,000 tokens and latency budgets are milliseconds, so every
 * provider reports the same units and the gateway can compare them.
 */
public record AiModel(
    String id,
    AiModelRouter.Tier tier,
    Set<AiCapability> capabilities,
    long costMicrosPerToken,
    long latencyBudgetMs) {

  public AiModel {
    if (id == null || id.isBlank()) {
      throw new IllegalArgumentException("model id is required");
    }
    if (tier == null) {
      throw new IllegalArgumentException("model tier is required");
    }
    if (capabilities == null || capabilities.isEmpty()) {
      throw new IllegalArgumentException("model capabilities are required");
    }
    if (costMicrosPerToken < 0) {
      throw new IllegalArgumentException("model cost must not be negative");
    }
    if (latencyBudgetMs <= 0) {
      throw new IllegalArgumentException("model latency budget must be positive");
    }
    capabilities = Set.copyOf(EnumSet.copyOf(capabilities));
  }
}

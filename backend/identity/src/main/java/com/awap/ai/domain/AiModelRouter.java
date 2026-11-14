package com.awap.ai.domain;

import java.util.Locale;

/**
 * Policy-based dynamic model routing (C4/C9). The decision is deterministic and explainable, so the
 * routed model can be audited and evaluated against a golden set.
 */
public final class AiModelRouter {

  public enum Tier {
    CHEAP,
    STANDARD,
    COMPLEX
  }

  public record Decision(Tier tier, String model, double complexity, String reason) {}

  private final String cheapModel;
  private final String standardModel;
  private final String complexModel;

  public AiModelRouter(String cheapModel, String standardModel, String complexModel) {
    this.cheapModel = blankToDefault(cheapModel, "local-heuristic");
    this.standardModel = blankToDefault(standardModel, "gpt-4o-mini");
    this.complexModel = blankToDefault(complexModel, "gpt-4o");
  }

  public Decision route(String input, String action) {
    String text = input == null ? "" : input.toLowerCase(Locale.ROOT);
    double complexity = Math.min(1.0, text.length() / 1_000.0);
    if ("CLASSIFY".equalsIgnoreCase(action)) {
      complexity += 0.1;
    }
    if ("SUMMARIZE".equalsIgnoreCase(action)) {
      complexity += 0.05;
    }
    if (text.contains(" and ") || text.contains(" then ") || text.contains("multiple")) {
      complexity += 0.2;
    }
    if (text.contains("workflow")) {
      complexity += 0.1;
    }
    if (text.contains("approval")) {
      complexity += 0.1;
    }
    if (text.contains("document")) {
      complexity += 0.1;
    }
    if (text.contains("task")) {
      complexity += 0.05;
    }
    complexity = Math.max(0.0, Math.min(1.0, complexity));
    if (complexity >= 0.55) {
      return new Decision(Tier.COMPLEX, complexModel, complexity, "multi-step request");
    }
    if (complexity >= 0.3) {
      return new Decision(Tier.STANDARD, standardModel, complexity, "moderate request");
    }
    return new Decision(Tier.CHEAP, cheapModel, complexity, "short low-risk request");
  }

  private static String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }
}

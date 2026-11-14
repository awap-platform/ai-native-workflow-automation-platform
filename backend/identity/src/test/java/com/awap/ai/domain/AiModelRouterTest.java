package com.awap.ai.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AiModelRouterTest {

  private final AiModelRouter router = new AiModelRouter("cheap", "standard", "complex");

  @Test
  void shortRequestUsesTheCheapModel() {
    AiModelRouter.Decision decision = router.route("hello", "SUMMARIZE");

    assertThat(decision.tier()).isEqualTo(AiModelRouter.Tier.CHEAP);
    assertThat(decision.model()).isEqualTo("cheap");
  }

  @Test
  void multiStepRequestUsesTheComplexModel() {
    AiModelRouter.Decision decision =
        router.route(
            "start a workflow and then compare multiple approval steps for the document",
            "SUMMARIZE");

    assertThat(decision.tier()).isEqualTo(AiModelRouter.Tier.COMPLEX);
    assertThat(decision.model()).isEqualTo("complex");
  }

  @Test
  void moderateRequestUsesTheStandardModel() {
    AiModelRouter.Decision decision =
        router.route("compare the approval policy for this workflow", "CLASSIFY");

    assertThat(decision.tier()).isEqualTo(AiModelRouter.Tier.STANDARD);
    assertThat(decision.model()).isEqualTo("standard");
  }
}

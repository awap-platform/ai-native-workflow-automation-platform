package com.awap.ai.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class AiGuardrailsOutputTest {

  @Test
  void systemPromptLeakIsBlocked() {
    assertThatThrownBy(() -> AiGuardrails.sanitizeOutput("Here is my prompt: secret"))
        .isInstanceOf(AiGuardrailViolationException.class);
  }

  @Test
  void substantiveOutputIsAccepted() {
    assertThat(AiGuardrails.sanitizeOutput("  The workflow was started.  "))
        .isEqualTo("The workflow was started.");
  }
}

package com.awap.common.knowledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** Deterministic embeddings and PII redaction (issue #293). */
class KnowledgeEmbeddingTest {

  @Test
  void embeddingsAreDeterministicNormalizedAndDimensioned() {
    LocalHashEmbeddingProvider provider = new LocalHashEmbeddingProvider(64);

    float[] first = provider.embed("Annual leave policy");
    float[] second = provider.embed("Annual leave policy");
    float[] different = provider.embed("Expense reimbursement");

    assertThat(first).isEqualTo(second).hasSize(64);
    assertThat(first).isNotEqualTo(different);
    double norm = 0.0;
    for (float value : first) {
      norm += value * value;
    }
    assertThat(Math.sqrt(norm)).isCloseTo(1.0, within(0.0001));
    assertThat(provider.id()).isEqualTo("local-hash");
    assertThat(provider.version()).isEqualTo("v1");
    assertThat(provider.dimensions()).isEqualTo(64);
  }

  @Test
  void nonTokenTextProducesAZeroVector() {
    float[] vector = new LocalHashEmbeddingProvider(32).embed("!!!");

    assertThat(vector).containsOnly(0.0f);
  }

  @Test
  void invalidEmbeddingInputAndDimensionsAreRejected() {
    assertThatThrownBy(() -> new LocalHashEmbeddingProvider(8))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("dimensions");
    assertThatThrownBy(() -> new LocalHashEmbeddingProvider(5_000))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("dimensions");
    assertThatThrownBy(() -> new LocalHashEmbeddingProvider(64).embed(" "))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("blank");
    assertThatThrownBy(() -> new LocalHashEmbeddingProvider(64).embed(null))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void piiRedactionMasksEmailsAndPhones() {
    KnowledgePiiRedactor redactor = new KnowledgePiiRedactor();
    String text = "Email jane@example.com or call +905551112233.";

    String redacted = redactor.redact(text);

    assertThat(redacted).contains("[email]").contains("[phone]").doesNotContain("jane@example.com");
    assertThat(redactor.containsPii(text)).isTrue();
    assertThat(redactor.containsPii("plain policy text")).isFalse();
    assertThat(redactor.redact(null)).isEmpty();
    assertThat(redactor.redact("")).isEmpty();
    assertThat(redactor.containsPii(null)).isFalse();
  }

  private static org.assertj.core.data.Offset<Double> within(double value) {
    return org.assertj.core.data.Offset.offset(value);
  }
}

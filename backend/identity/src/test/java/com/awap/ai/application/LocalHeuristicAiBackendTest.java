package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class LocalHeuristicAiBackendTest {

  private final LocalHeuristicAiBackend backend = new LocalHeuristicAiBackend();

  @Test
  void extractsInvoiceFieldsDeterministically() {
    String output =
        backend.complete(
            "extract:{}\nvendor: Acme Corp\namount: 123.45\n"
                + "due date: 2026-12-01\ncategory: INVOICE",
            1_024);

    assertThat(output)
        .contains("\"vendor\":\"Acme Corp\"")
        .contains("\"amount\":123.45")
        .contains("\"dueDate\":\"2026-12-01\"")
        .contains("\"category\":\"INVOICE\"");
  }

  @Test
  void extractionWithoutRecognisedFieldsReturnsAnEmptyObject() {
    assertThat(backend.complete("extract:{}\nnothing to see", 1_024)).isEqualTo("{}");
    assertThat(backend.complete("extract:no-newline", 1_024)).isEqualTo("{}");
  }

  @Test
  void keepsTheLegacySummarizeAndClassifyHeuristics() {
    assertThat(backend.complete("summarize:a short text", 10)).isEqualTo("a short text");
    assertThat(backend.complete("classify:an invoice payment", 10)).isEqualTo("FINANCE");
    assertThat(backend.complete("classify:a contract agreement", 10)).isEqualTo("LEGAL");
    assertThat(backend.complete("classify:anything else", 10)).isEqualTo("GENERAL");
    assertThat(backend.complete("unknown:prompt", 10)).isEmpty();
  }
}

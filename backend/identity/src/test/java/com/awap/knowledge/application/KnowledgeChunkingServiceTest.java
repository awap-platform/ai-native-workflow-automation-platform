package com.awap.knowledge.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class KnowledgeChunkingServiceTest {

  private final KnowledgeChunkingService service = new KnowledgeChunkingService();

  @Test
  void blankContentProducesNoChunks() {
    assertThat(service.chunk(" ")).isEmpty();
  }

  @Test
  void longContentIsSplitWithOverlap() {
    String text = "Sentence one. ".repeat(120);

    List<String> chunks = service.chunk(text, 200, 40);

    assertThat(chunks).hasSizeGreaterThan(1);
    assertThat(chunks).allSatisfy(chunk -> assertThat(chunk.length()).isLessThanOrEqualTo(200));
  }

  @Test
  void shortContentIsOneChunk() {
    assertThat(service.chunk("Annual leave policy", 200, 40))
        .containsExactly("Annual leave policy");
  }
}

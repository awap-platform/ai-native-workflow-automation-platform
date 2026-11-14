package com.awap.common.knowledge;

import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Deterministic document chunker. Chunks are sentence-aware where possible, bounded by the
 * configured character budget and overlap, so retrieval quality can be evaluated and reproduced.
 */
@Service
public class KnowledgeChunkingService {

  static final int DEFAULT_MAX_CHARS = 1_000;
  static final int DEFAULT_OVERLAP = 150;

  public List<String> chunk(String text) {
    return chunk(text, DEFAULT_MAX_CHARS, DEFAULT_OVERLAP);
  }

  public List<String> chunk(String text, int maxChars, int overlap) {
    if (text == null || text.isBlank()) {
      return List.of();
    }
    int limit = Math.max(100, maxChars);
    int overlapChars = Math.max(0, Math.min(overlap, limit / 2));
    String normalized = text.replace('\u0000', ' ').replaceAll("\\s+", " ").trim();
    List<String> chunks = new ArrayList<>();
    int start = 0;
    while (start < normalized.length()) {
      int end = Math.min(normalized.length(), start + limit);
      if (end < normalized.length()) {
        int sentence =
            Math.max(
                normalized.lastIndexOf(". ", end),
                Math.max(normalized.lastIndexOf("? ", end), normalized.lastIndexOf("! ", end)));
        if (sentence > start + limit / 2) {
          end = sentence + 1;
        }
      }
      chunks.add(normalized.substring(start, end).trim());
      if (end >= normalized.length()) {
        break;
      }
      start = Math.max(start + 1, end - overlapChars);
    }
    return chunks;
  }
}

package com.awap.knowledge.domain;

import java.util.UUID;

/** One tenant-scoped searchable chunk of a document. */
public record KnowledgeChunk(
    UUID tenantId,
    UUID fileId,
    String title,
    String format,
    int version,
    int chunkIndex,
    String content) {

  public String documentId() {
    return fileId + "-" + version + "-" + chunkIndex;
  }
}

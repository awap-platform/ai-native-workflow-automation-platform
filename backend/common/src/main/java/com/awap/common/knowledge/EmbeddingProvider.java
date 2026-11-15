package com.awap.common.knowledge;

/** Provider-neutral embedding SPI (issue #293). */
public interface EmbeddingProvider {

  /** Stable provider id, e.g. {@code local-hash}. */
  String id();

  /** Embedding model/version stored with every vector so reindexes are auditable. */
  String version();

  int dimensions();

  /** Returns a finite, normalized vector of {@link #dimensions()} elements. */
  float[] embed(String text);
}

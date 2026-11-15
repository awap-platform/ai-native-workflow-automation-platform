package com.awap.common.knowledge;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Deterministic offline embedding provider (issue #293).
 *
 * <p>Tokens are hashed into a fixed number of dimensions with a signed bag-of-words projection and
 * L2-normalized. It is not a semantic model, but it is stable, free, private and lets the hybrid
 * pipeline, vector mapping and evaluation gates run without an external embedding vendor.
 */
@Component
public class LocalHashEmbeddingProvider implements EmbeddingProvider {

  public static final String ID = "local-hash";
  public static final String VERSION = "v1";
  static final int MIN_DIMENSIONS = 16;
  static final int MAX_DIMENSIONS = 4_096;
  private static final Pattern TOKEN = Pattern.compile("[\\p{L}\\p{N}]+");

  private final int dimensions;

  public LocalHashEmbeddingProvider(
      @Value("${awap.knowledge.embedding.dimensions:256}") int dimensions) {
    if (dimensions < MIN_DIMENSIONS || dimensions > MAX_DIMENSIONS) {
      throw new IllegalArgumentException(
          "Embedding dimensions must be between "
              + MIN_DIMENSIONS
              + " and "
              + MAX_DIMENSIONS
              + ".");
    }
    this.dimensions = dimensions;
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public String version() {
    return VERSION;
  }

  @Override
  public int dimensions() {
    return dimensions;
  }

  @Override
  public float[] embed(String text) {
    if (text == null || text.isBlank()) {
      throw new IllegalArgumentException("Embedding text must not be blank.");
    }
    float[] vector = new float[dimensions];
    Matcher tokens = TOKEN.matcher(text.toLowerCase(Locale.ROOT));
    while (tokens.find()) {
      String token = tokens.group();
      int hash = token.hashCode();
      int index = Math.floorMod(hash, dimensions);
      vector[index] += (hash & 1) == 0 ? 1.0f : -1.0f;
    }
    double norm = 0.0;
    for (float value : vector) {
      norm += value * value;
    }
    if (norm > 0.0) {
      float scale = (float) (1.0 / Math.sqrt(norm));
      for (int index = 0; index < vector.length; index += 1) {
        vector[index] *= scale;
      }
    }
    return vector;
  }
}

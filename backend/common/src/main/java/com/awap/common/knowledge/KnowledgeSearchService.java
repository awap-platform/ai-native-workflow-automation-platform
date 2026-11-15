package com.awap.common.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Tenant-scoped hybrid knowledge search over OpenSearch (issue #293).
 *
 * <p>Lexical ({@code multi_match}) and vector (kNN) results are fused with Reciprocal Rank Fusion.
 * Every query carries the tenant filter in both branches, and source documents are re-checked
 * before they are returned. A vector/embedding failure degrades to lexical results; an OpenSearch
 * outage degrades to an empty result. Neither path can leak another tenant's data.
 */
@Service
public class KnowledgeSearchService {

  private static final Logger log = LoggerFactory.getLogger(KnowledgeSearchService.class);
  private static final double RRF_K = 60.0;

  private final KnowledgeOpenSearchClient client;
  private final KnowledgeChunkingService chunkingService;
  private final ObjectMapper objectMapper;
  private final MeterRegistry meterRegistry;
  private final String index;
  private final EmbeddingProvider embeddings;
  private final KnowledgePiiRedactor piiRedactor;

  @Autowired
  public KnowledgeSearchService(
      KnowledgeOpenSearchClient client,
      KnowledgeChunkingService chunkingService,
      ObjectMapper objectMapper,
      MeterRegistry meterRegistry,
      @Value("${awap.knowledge.index:awap-knowledge}") String index,
      EmbeddingProvider embeddings,
      KnowledgePiiRedactor piiRedactor) {
    this.client = client;
    this.chunkingService = chunkingService;
    this.objectMapper = objectMapper;
    this.meterRegistry = meterRegistry;
    this.index = index;
    this.embeddings = embeddings;
    this.piiRedactor = piiRedactor;
  }

  /** Backward-compatible constructor for focused tests without Spring. */
  public KnowledgeSearchService(
      KnowledgeOpenSearchClient client,
      KnowledgeChunkingService chunkingService,
      ObjectMapper objectMapper,
      MeterRegistry meterRegistry,
      String index) {
    this(
        client,
        chunkingService,
        objectMapper,
        meterRegistry,
        index,
        new LocalHashEmbeddingProvider(256),
        new KnowledgePiiRedactor());
  }

  public List<KnowledgeHit> search(UUID tenantId, String query, int limit) {
    String effectiveQuery = query == null ? "" : query.trim();
    if (effectiveQuery.isEmpty()) {
      return List.of();
    }
    try {
      return searchHybrid(tenantId, effectiveQuery, Math.max(1, limit));
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      meterRegistry
          .counter("awap.knowledge.search.fallback", "reason", "InterruptedException")
          .increment();
      log.warn("Knowledge OpenSearch query was interrupted; returning no hits: {}", ex.toString());
      return List.of();
    } catch (Exception ex) {
      meterRegistry
          .counter("awap.knowledge.search.fallback", "reason", ex.getClass().getSimpleName())
          .increment();
      log.warn("Knowledge OpenSearch query failed; returning no hits: {}", ex.toString());
      return List.of();
    }
  }

  public int indexDocument(
      UUID tenantId, UUID fileId, String title, String content, String format, int version) {
    String safeTitle = piiRedactor.redact(title);
    String safeContent = piiRedactor.redact(content);
    List<String> chunks = chunkingService.chunk(safeContent);
    if (chunks.isEmpty()) {
      chunks = chunkingService.chunk(safeTitle);
    }
    try {
      StringBuilder bulk = new StringBuilder();
      for (int indexNumber = 0; indexNumber < chunks.size(); indexNumber++) {
        KnowledgeChunk chunk =
            new KnowledgeChunk(
                tenantId, fileId, safeTitle, format, version, indexNumber, chunks.get(indexNumber));
        ObjectNode action = objectMapper.createObjectNode();
        action.putObject("index").put("_index", index).put("_id", chunk.documentId());
        bulk.append(objectMapper.writeValueAsString(action)).append('\n');
        bulk.append(objectMapper.writeValueAsString(source(chunk))).append('\n');
      }
      KnowledgeOpenSearchClient.Response response =
          client.post("/_bulk?refresh=true", bulk.toString());
      boolean ok = response.status() / 100 == 2;
      meterRegistry
          .counter("awap.knowledge.index.chunks", "outcome", ok ? "success" : "failure")
          .increment(chunks.size());
      return ok ? chunks.size() : 0;
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      meterRegistry.counter("awap.knowledge.index.failures").increment();
      log.warn("Knowledge indexing was interrupted for file {}: {}", fileId, ex.toString());
      return 0;
    } catch (Exception ex) {
      meterRegistry.counter("awap.knowledge.index.failures").increment();
      log.warn("Knowledge indexing failed for file {}: {}", fileId, ex.toString());
      return 0;
    }
  }

  private ObjectNode source(KnowledgeChunk chunk) {
    ObjectNode source = objectMapper.createObjectNode();
    source.put("tenantId", chunk.tenantId().toString());
    source.put("fileId", chunk.fileId().toString());
    source.put("title", chunk.title());
    source.put("format", chunk.format());
    source.put("version", chunk.version());
    source.put("chunkIndex", chunk.chunkIndex());
    source.put("content", chunk.content());
    float[] vector = embeddingOf(chunk.content());
    if (vector != null) {
      ArrayNode array = source.putArray("embedding");
      for (float value : vector) {
        array.add(value);
      }
      source.put("embeddingModel", embeddings.id());
      source.put("embeddingVersion", embeddings.version());
    }
    return source;
  }

  private float[] embeddingOf(String text) {
    try {
      float[] vector = embeddings.embed(text);
      if (!validVector(vector)) {
        meterRegistry.counter("awap.knowledge.embedding.failures", "reason", "invalid").increment();
        return null;
      }
      return vector;
    } catch (RuntimeException ex) {
      meterRegistry.counter("awap.knowledge.embedding.failures", "reason", "provider").increment();
      log.warn("Embedding generation failed; indexing text only: {}", ex.toString());
      return null;
    }
  }

  private List<KnowledgeHit> searchHybrid(UUID tenantId, String query, int limit) throws Exception {
    List<KnowledgeHit> lexical = lexicalSearch(tenantId, query, limit);
    List<KnowledgeHit> vector = vectorSearch(tenantId, query, limit);
    meterRegistry.counter("awap.knowledge.search", "backend", "hybrid").increment();
    return fuse(lexical, vector, limit);
  }

  private List<KnowledgeHit> lexicalSearch(UUID tenantId, String query, int limit)
      throws Exception {
    ObjectNode root = objectMapper.createObjectNode();
    ObjectNode queryNode = root.putObject("query").putObject("bool");
    queryNode.putObject("filter").putObject("term").put("tenantId", tenantId.toString());
    ObjectNode multiMatch = queryNode.putObject("must").putObject("multi_match");
    multiMatch.put("query", query);
    multiMatch.putArray("fields").add("title^2").add("content");
    multiMatch.put("type", "best_fields");
    root.put("size", limit);
    KnowledgeOpenSearchClient.Response response =
        client.post("/" + index + "/_search", objectMapper.writeValueAsString(root));
    if (response.status() / 100 != 2) {
      throw new IllegalStateException("OpenSearch returned status " + response.status());
    }
    meterRegistry.counter("awap.knowledge.search", "backend", "lexical").increment();
    return parseHits(
        objectMapper.readTree(response.body()).path("hits").path("hits"), tenantId, query);
  }

  private List<KnowledgeHit> vectorSearch(UUID tenantId, String query, int limit) throws Exception {
    float[] queryVector;
    try {
      queryVector = embeddings.embed(piiRedactor.redact(query));
    } catch (RuntimeException ex) {
      meterRegistry
          .counter("awap.knowledge.search.vector_fallback", "reason", "embedding-error")
          .increment();
      log.warn("Query embedding failed; using lexical results only: {}", ex.toString());
      return List.of();
    }
    if (!validVector(queryVector)) {
      meterRegistry
          .counter("awap.knowledge.search.vector_fallback", "reason", "invalid-vector")
          .increment();
      return List.of();
    }
    if (!hasSignal(queryVector)) {
      meterRegistry
          .counter("awap.knowledge.search.vector_fallback", "reason", "empty-vector")
          .increment();
      return List.of();
    }
    ObjectNode root = objectMapper.createObjectNode();
    root.put("size", limit);
    ObjectNode knn = root.putObject("query").putObject("knn").putObject("embedding");
    ArrayNode vectorNode = knn.putArray("vector");
    for (float value : queryVector) {
      vectorNode.add(value);
    }
    knn.put("k", limit);
    knn.putObject("filter").putObject("term").put("tenantId", tenantId.toString());
    KnowledgeOpenSearchClient.Response response =
        client.post("/" + index + "/_search", objectMapper.writeValueAsString(root));
    if (response.status() / 100 != 2) {
      meterRegistry
          .counter("awap.knowledge.search.vector_fallback", "reason", "status")
          .increment();
      return List.of();
    }
    meterRegistry.counter("awap.knowledge.search", "backend", "vector").increment();
    return parseHits(
        objectMapper.readTree(response.body()).path("hits").path("hits"), tenantId, query);
  }

  private List<KnowledgeHit> parseHits(JsonNode hits, UUID tenantId, String query) {
    List<KnowledgeHit> results = new ArrayList<>();
    for (JsonNode hit : hits) {
      JsonNode source = hit.path("_source");
      if (!tenantId.toString().equals(source.path("tenantId").asText())) {
        continue; // defense in depth: never return a foreign document
      }
      results.add(
          new KnowledgeHit(
              source.path("fileId").asText(),
              source.path("title").asText(source.path("fileId").asText()),
              source.path("format").asText(""),
              source.path("version").asInt(1),
              source.path("chunkIndex").asInt(0),
              snippet(source.path("content").asText(""), query),
              hit.path("_score").asDouble(0.0)));
    }
    return results;
  }

  private static List<KnowledgeHit> fuse(
      List<KnowledgeHit> lexical, List<KnowledgeHit> vector, int limit) {
    Map<String, Double> scores = new LinkedHashMap<>();
    Map<String, KnowledgeHit> hits = new LinkedHashMap<>();
    accumulate(lexical, scores, hits);
    accumulate(vector, scores, hits);
    return scores.entrySet().stream()
        .sorted(
            Map.Entry.<String, Double>comparingByValue(Comparator.reverseOrder())
                .thenComparing(Map.Entry.comparingByKey()))
        .limit(limit)
        .map(entry -> withScore(hits.get(entry.getKey()), entry.getValue()))
        .toList();
  }

  private static void accumulate(
      List<KnowledgeHit> results, Map<String, Double> scores, Map<String, KnowledgeHit> hits) {
    for (int rank = 0; rank < results.size(); rank += 1) {
      KnowledgeHit hit = results.get(rank);
      String key = hit.fileId() + ":" + hit.chunkIndex();
      scores.merge(key, 1.0 / (RRF_K + rank + 1), Double::sum);
      hits.putIfAbsent(key, hit);
    }
  }

  private static KnowledgeHit withScore(KnowledgeHit hit, double score) {
    return new KnowledgeHit(
        hit.fileId(),
        hit.title(),
        hit.format(),
        hit.version(),
        hit.chunkIndex(),
        hit.snippet(),
        score);
  }

  private boolean validVector(float[] vector) {
    if (vector == null || vector.length != embeddings.dimensions()) {
      return false;
    }
    for (float value : vector) {
      if (!Float.isFinite(value)) {
        return false;
      }
    }
    return true;
  }

  private static boolean hasSignal(float[] vector) {
    for (float value : vector) {
      if (value != 0.0f) {
        return true;
      }
    }
    return false;
  }

  private static String snippet(String content, String query) {
    if (content == null || content.isBlank()) {
      return "";
    }
    String lowered = content.toLowerCase(Locale.ROOT);
    int position = lowered.indexOf(query.toLowerCase(Locale.ROOT));
    if (position < 0) {
      return content.substring(0, Math.min(300, content.length()));
    }
    int start = Math.max(0, position - 80);
    int end = Math.min(content.length(), position + query.length() + 220);
    return content.substring(start, end);
  }

  /** Public, tenant-safe search result. */
  public record KnowledgeHit(
      String fileId,
      String title,
      String format,
      int version,
      int chunkIndex,
      String snippet,
      double score) {}
}

package com.awap.common.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Tenant-scoped knowledge search over OpenSearch.
 *
 * <p>The tenant filter is part of every query. An OpenSearch outage degrades to an empty result
 * (counted and logged) instead of returning another tenant's data or failing the caller.
 */
@Service
public class KnowledgeSearchService {

  private static final Logger log = LoggerFactory.getLogger(KnowledgeSearchService.class);

  private final KnowledgeOpenSearchClient client;
  private final KnowledgeChunkingService chunkingService;
  private final ObjectMapper objectMapper;
  private final MeterRegistry meterRegistry;
  private final String index;

  public KnowledgeSearchService(
      KnowledgeOpenSearchClient client,
      KnowledgeChunkingService chunkingService,
      ObjectMapper objectMapper,
      MeterRegistry meterRegistry,
      @Value("${awap.knowledge.index:awap-knowledge}") String index) {
    this.client = client;
    this.chunkingService = chunkingService;
    this.objectMapper = objectMapper;
    this.meterRegistry = meterRegistry;
    this.index = index;
  }

  public List<KnowledgeHit> search(UUID tenantId, String query, int limit) {
    String effectiveQuery = query == null ? "" : query.trim();
    if (effectiveQuery.isEmpty()) {
      return List.of();
    }
    try {
      return searchOpenSearch(tenantId, effectiveQuery, Math.max(1, limit));
    } catch (InterruptedException ex) {
      // A cancelled request must not lose the interrupt signal for the caller thread.
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
    List<String> chunks = chunkingService.chunk(content);
    if (chunks.isEmpty()) {
      chunks = chunkingService.chunk(title == null ? "" : title);
    }
    try {
      StringBuilder bulk = new StringBuilder();
      for (int indexNumber = 0; indexNumber < chunks.size(); indexNumber++) {
        KnowledgeChunk chunk =
            new KnowledgeChunk(
                tenantId, fileId, title, format, version, indexNumber, chunks.get(indexNumber));
        ObjectNode action = objectMapper.createObjectNode();
        action.putObject("index").put("_index", index).put("_id", chunk.documentId());
        bulk.append(objectMapper.writeValueAsString(action)).append('\n');
        bulk.append(
                objectMapper.writeValueAsString(
                    new IndexedChunk(
                        tenantId.toString(),
                        fileId.toString(),
                        title,
                        format,
                        version,
                        indexNumber,
                        chunk.content())))
            .append('\n');
      }
      KnowledgeOpenSearchClient.Response response =
          client.post("/_bulk?refresh=true", bulk.toString());
      boolean ok = response.status() / 100 == 2;
      meterRegistry
          .counter("awap.knowledge.index.chunks", "outcome", ok ? "success" : "failure")
          .increment(chunks.size());
      return ok ? chunks.size() : 0;
    } catch (InterruptedException ex) {
      // A cancelled request must not lose the interrupt signal for the caller thread.
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

  private List<KnowledgeHit> searchOpenSearch(UUID tenantId, String query, int limit)
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
    JsonNode hits = objectMapper.readTree(response.body()).path("hits").path("hits");
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
    meterRegistry.counter("awap.knowledge.search", "backend", "opensearch").increment();
    return results;
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

  private record IndexedChunk(
      String tenantId,
      String fileId,
      String title,
      String format,
      int version,
      int chunkIndex,
      String content) {}
}

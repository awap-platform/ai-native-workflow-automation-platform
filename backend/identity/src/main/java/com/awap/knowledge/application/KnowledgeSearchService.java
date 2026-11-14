package com.awap.knowledge.application;

import com.awap.analytics.infrastructure.opensearch.OpenSearchResponse;
import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import com.awap.document.application.DocumentService;
import com.awap.document.domain.DocumentVersion;
import com.awap.knowledge.domain.KnowledgeChunk;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Tenant-scoped knowledge search over OpenSearch with a deterministic metadata fallback.
 *
 * <p>The tenant filter is part of every query. If OpenSearch is disabled or unavailable, the
 * service falls back to the tenant's document metadata so the copilot still returns only own-tenant
 * data.
 */
@Service
public class KnowledgeSearchService {

  private static final Logger log = LoggerFactory.getLogger(KnowledgeSearchService.class);

  private final ObjectProvider<OpenSearchTransport> transportProvider;
  private final DocumentService documentService;
  private final KnowledgeChunkingService chunkingService;
  private final ObjectMapper objectMapper;
  private final MeterRegistry meterRegistry;
  private final String index;

  public KnowledgeSearchService(
      ObjectProvider<OpenSearchTransport> transportProvider,
      DocumentService documentService,
      KnowledgeChunkingService chunkingService,
      ObjectMapper objectMapper,
      MeterRegistry meterRegistry,
      @Value("${awap.knowledge.index:awap-knowledge}") String index) {
    this.transportProvider = transportProvider;
    this.documentService = documentService;
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
    OpenSearchTransport transport = transportProvider.getIfAvailable();
    if (transport != null) {
      try {
        return searchOpenSearch(transport, tenantId, effectiveQuery, Math.max(1, limit));
      } catch (Exception ex) {
        meterRegistry
            .counter("awap.knowledge.search.fallback", "reason", ex.getClass().getSimpleName())
            .increment();
        log.warn("Knowledge OpenSearch query failed; using metadata fallback: {}", ex.toString());
      }
    }
    return searchMetadata(tenantId, effectiveQuery, Math.max(1, limit));
  }

  public int indexDocument(
      UUID tenantId, UUID fileId, String title, String content, String format, int version) {
    List<String> chunks = chunkingService.chunk(content);
    if (chunks.isEmpty()) {
      chunks = chunkingService.chunk(title == null ? "" : title);
    }
    OpenSearchTransport transport = transportProvider.getIfAvailable();
    if (transport == null) {
      meterRegistry
          .counter("awap.knowledge.index.skipped", "reason", "opensearch_disabled")
          .increment();
      return 0;
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
      OpenSearchResponse response =
          transport.execute(
              "POST",
              "/_bulk?refresh=true",
              bulk.toString().getBytes(StandardCharsets.UTF_8).length > 0 ? bulk.toString() : null);
      boolean ok = response.status() / 100 == 2;
      meterRegistry
          .counter("awap.knowledge.index.chunks", "outcome", ok ? "success" : "failure")
          .increment(chunks.size());
      return ok ? chunks.size() : 0;
    } catch (Exception ex) {
      meterRegistry.counter("awap.knowledge.index.failures").increment();
      log.warn("Knowledge indexing failed for file {}: {}", fileId, ex.toString());
      return 0;
    }
  }

  private List<KnowledgeHit> searchOpenSearch(
      OpenSearchTransport transport, UUID tenantId, String query, int limit) throws Exception {
    ObjectNode root = objectMapper.createObjectNode();
    ObjectNode queryNode = root.putObject("query").putObject("bool");
    queryNode.putObject("filter").putObject("term").put("tenantId", tenantId.toString());
    ObjectNode multiMatch = queryNode.putObject("must").putObject("multi_match");
    multiMatch.put("query", query);
    multiMatch.putArray("fields").add("title^2").add("content");
    multiMatch.put("type", "best_fields");
    root.put("size", limit);
    OpenSearchResponse response =
        transport.execute("POST", "/" + index + "/_search", objectMapper.writeValueAsString(root));
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

  private List<KnowledgeHit> searchMetadata(UUID tenantId, String query, int limit) {
    List<String> tokens = searchTokens(query);
    List<KnowledgeHit> results = new ArrayList<>();
    for (DocumentVersion document : documentService.list(tenantId)) {
      String haystack =
          (document.getObjectKey() + " " + document.getFormat() + " " + document.getFileId())
              .toLowerCase(Locale.ROOT);
      boolean matches = tokens.isEmpty() || tokens.stream().anyMatch(haystack::contains);
      if (matches) {
        results.add(
            new KnowledgeHit(
                document.getFileId().toString(),
                document.getObjectKey(),
                document.getFormat(),
                1,
                0,
                document.getObjectKey(),
                1.0));
      }
      if (results.size() >= limit) {
        break;
      }
    }
    meterRegistry.counter("awap.knowledge.search", "backend", "metadata").increment();
    return results;
  }

  private static final java.util.Map<String, String> QUERY_SYNONYMS =
      java.util.Map.ofEntries(
          java.util.Map.entry("izin", "leave"),
          java.util.Map.entry("talep", "request"),
          java.util.Map.entry("görev", "task"),
          java.util.Map.entry("onay", "approval"),
          java.util.Map.entry("belge", "document"),
          java.util.Map.entry("doküman", "document"),
          java.util.Map.entry("ara", "search"),
          java.util.Map.entry("bul", "find"),
          java.util.Map.entry("başlat", "start"));

  private static final java.util.Set<String> ACTION_STOPWORDS =
      java.util.Set.of("start", "başlat", "initiate", "search", "ara", "bul", "find", "lütfen");

  private static List<String> searchTokens(String query) {
    if (query == null || query.isBlank()) {
      return List.of();
    }
    return java.util.Arrays.stream(query.toLowerCase(Locale.ROOT).split("[^\\p{L}\\p{N}]+"))
        .filter(token -> token.length() > 2)
        .map(token -> QUERY_SYNONYMS.getOrDefault(token, token))
        .filter(token -> !ACTION_STOPWORDS.contains(token))
        .distinct()
        .toList();
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

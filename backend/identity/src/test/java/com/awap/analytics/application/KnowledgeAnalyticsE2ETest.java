package com.awap.analytics.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.analytics.domain.AnalyticsAggregate;
import com.awap.analytics.domain.AnalyticsEventSample;
import com.awap.analytics.domain.AnalyticsEventType;
import com.awap.analytics.infrastructure.AnalyticsAggregateRepository;
import com.awap.analytics.infrastructure.AnalyticsEventSampleRepository;
import com.awap.common.knowledge.EmbeddingProvider;
import com.awap.common.knowledge.KnowledgeChunkingService;
import com.awap.common.knowledge.KnowledgeOpenSearchClient;
import com.awap.common.knowledge.KnowledgePiiRedactor;
import com.awap.common.knowledge.KnowledgeSearchService;
import com.awap.common.knowledge.KnowledgeSearchService.KnowledgeHit;
import com.awap.common.knowledge.LocalHashEmbeddingProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * End-to-end knowledge search plus advanced analytics contract (issue #308, E2E step 9).
 *
 * <p>The seeded document goes through the real chunker, PII redactor, embedding provider and
 * indexing/search service. Only the OpenSearch HTTP transport is replaced by a deterministic
 * in-memory fake so the scenario runs on every pull request without a container, and the analytics
 * aggregates use in-memory repository doubles. The real-OpenSearch variant lives in {@link
 * KnowledgeAnalyticsOpenSearchIntegrationTest}.
 */
class KnowledgeAnalyticsE2ETest {

  private static final String INDEX = "awap-knowledge-e2e";
  private static final int DIMENSIONS = 64;
  private static final String LEAVE_CONTENT =
      ("Employees may request annual leave through the portal. "
              + "Contact hr@example.com or +90 555 123 4567 for exceptions. ")
          .repeat(15);

  private final ObjectMapper mapper = new ObjectMapper();
  private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
  private final List<Map<String, Object>> sinkDocuments = new ArrayList<>();
  private final Map<String, AnalyticsAggregate> aggregates = new ConcurrentHashMap<>();
  private final List<AnalyticsEventSample> samples = new ArrayList<>();
  private final AnalyticsAggregateRepository aggregateRepository =
      mock(AnalyticsAggregateRepository.class);
  private final AnalyticsEventSampleRepository sampleRepository =
      mock(AnalyticsEventSampleRepository.class);

  private FakeOpenSearch openSearch;
  private EmbeddingProvider embeddings;
  private KnowledgeSearchService knowledge;
  private AnalyticsService analytics;
  private AnalyticsAggregationService dashboards;

  @BeforeEach
  void setUp() {
    openSearch = new FakeOpenSearch(mapper);
    embeddings = new LocalHashEmbeddingProvider(DIMENSIONS);
    knowledge =
        new KnowledgeSearchService(
            openSearch,
            new KnowledgeChunkingService(),
            mapper,
            meters,
            INDEX,
            embeddings,
            new KnowledgePiiRedactor());
    stubAnalyticsRepositories();
    analytics =
        new AnalyticsService(
            meters,
            aggregateRepository,
            document -> sinkDocuments.add(new LinkedHashMap<>(document)),
            sampleRepository);
    dashboards = new AnalyticsAggregationService(aggregateRepository, sampleRepository);
  }

  @Test
  void seededDocumentIsIndexedSearchedAndCountedAsAnAnalyticsStep() {
    UUID tenant = UUID.randomUUID();
    UUID file = UUID.randomUUID();

    int chunks = knowledge.indexDocument(tenant, file, "Leave policy", LEAVE_CONTENT, "pdf", 3);

    assertThat(chunks).isGreaterThanOrEqualTo(2);
    assertThat(openSearch.documents()).hasSize(chunks);
    assertThat(openSearch.documents().values())
        .allSatisfy(
            source -> {
              assertThat(source.path("tenantId").asText()).isEqualTo(tenant.toString());
              assertThat(source.path("fileId").asText()).isEqualTo(file.toString());
              assertThat(source.path("version").asInt()).isEqualTo(3);
              assertThat(source.path("embeddingModel").asText())
                  .isEqualTo(LocalHashEmbeddingProvider.ID);
            });

    List<KnowledgeHit> hits = knowledge.search(tenant, "annual leave", 5);

    assertThat(hits).isNotEmpty();
    assertThat(hits).allSatisfy(hit -> assertThat(hit.fileId()).isEqualTo(file.toString()));
    assertThat(hits).allSatisfy(hit -> assertThat(hit.title()).isEqualTo("Leave policy"));
    assertThat(hits)
        .extracting(KnowledgeHit::snippet)
        .allSatisfy(snippet -> assertThat(snippet).contains("annual leave"));
    assertThat(hits)
        .extracting(KnowledgeHit::snippet)
        .allSatisfy(snippet -> assertThat(snippet).doesNotContain("hr@example.com"));

    UUID instance = UUID.randomUUID();
    analytics.record(
        tenant, AnalyticsEventType.WORKFLOW_COMPLETED, instance, null, "knowledge", 1200L);

    AnalyticsDashboard view = dashboards.dashboard(tenant, todayQuery());

    assertThat(view.dataCompleteness().dailyTotalsAvailable()).isTrue();
    assertThat(view.dataCompleteness().rawEventsAvailable()).isTrue();
    assertThat(view.dataCompleteness().sampleCount()).isEqualTo(1);
    assertThat(view.dailyTotals())
        .singleElement()
        .satisfies(
            total -> {
              assertThat(total.eventType()).isEqualTo("WORKFLOW_COMPLETED");
              assertThat(total.count()).isEqualTo(1);
              assertThat(total.totalDurationMs()).isEqualTo(1200L);
              assertThat(total.averageDurationMs()).isEqualTo(1200L);
            });
    assertThat(view.timeBuckets())
        .singleElement()
        .satisfies(
            bucket -> {
              assertThat(bucket.bucket()).isEqualTo(LocalDate.now(ZoneOffset.UTC).toString());
              assertThat(bucket.total()).isEqualTo(1);
              assertThat(bucket.counts()).containsEntry("WORKFLOW_COMPLETED", 1L);
            });
    assertThat(view.workflowDuration().p50()).isEqualTo(1200L);
    assertThat(view.workflowDuration().p95()).isEqualTo(1200L);
    assertThat(view.taskCycleTime().sampleCount()).isZero();
    assertThat(view.approvalLatency().sampleCount()).isZero();
    assertThat(view.failureRate()).isZero();
    assertThat(view.slaBreachRate()).isZero();
    assertThat(view.bottlenecks())
        .singleElement()
        .satisfies(
            bottleneck -> {
              assertThat(bottleneck.nodeId()).isEqualTo("knowledge");
              assertThat(bottleneck.count()).isEqualTo(1);
              assertThat(bottleneck.averageDurationMs()).isEqualTo(1200L);
            });
    assertThat(view.groups())
        .singleElement()
        .satisfies(
            group -> {
              assertThat(group.key()).isEqualTo("WORKFLOW_COMPLETED");
              assertThat(group.count()).isEqualTo(1);
            });
    assertThat(view.trend().currentCount()).isEqualTo(1);
    assertThat(view.trend().previousCount()).isZero();

    assertThat(sinkDocuments)
        .singleElement()
        .satisfies(
            document -> {
              assertThat(document.get("tenantId")).isEqualTo(tenant.toString());
              assertThat(document.get("eventType")).isEqualTo("WORKFLOW_COMPLETED");
              assertThat(document.get("nodeId")).isEqualTo("knowledge");
              assertThat(document.toString()).doesNotContain("hr@example.com");
              assertThat(document.toString()).doesNotContain("555 123 4567");
            });
  }

  @Test
  void tenantIsolationHoldsForIndexingSearchAndAnalytics() {
    UUID tenantA = UUID.randomUUID();
    UUID tenantB = UUID.randomUUID();
    UUID fileA = UUID.randomUUID();
    UUID fileB = UUID.randomUUID();

    knowledge.indexDocument(tenantA, fileA, "Tenant A leave policy", LEAVE_CONTENT, "pdf", 1);
    knowledge.indexDocument(tenantB, fileB, "Tenant B leave policy", LEAVE_CONTENT, "pdf", 1);

    assertThat(knowledge.search(tenantA, "annual leave", 10))
        .isNotEmpty()
        .allSatisfy(hit -> assertThat(hit.fileId()).isEqualTo(fileA.toString()));
    assertThat(knowledge.search(tenantB, "annual leave", 10))
        .isNotEmpty()
        .allSatisfy(hit -> assertThat(hit.fileId()).isEqualTo(fileB.toString()));

    analytics.record(tenantA, AnalyticsEventType.TASK_COMPLETED, UUID.randomUUID(), null, "a", 10L);
    analytics.record(tenantB, AnalyticsEventType.SLA_BREACHED, UUID.randomUUID(), null, "b", 20L);

    assertThat(dashboards.dashboard(tenantA, todayQuery()).dailyTotals())
        .singleElement()
        .satisfies(total -> assertThat(total.eventType()).isEqualTo("TASK_COMPLETED"));
    assertThat(dashboards.dashboard(tenantB, todayQuery()).dailyTotals())
        .singleElement()
        .satisfies(total -> assertThat(total.eventType()).isEqualTo("SLA_BREACHED"));
    assertThat(dashboards.dashboard(UUID.randomUUID(), todayQuery()).dailyTotals()).isEmpty();
  }

  @Test
  void aForeignTenantDocumentInTheResultIsFilteredOut() {
    UUID tenant = UUID.randomUUID();
    UUID file = UUID.randomUUID();
    knowledge.indexDocument(tenant, file, "Leave policy", LEAVE_CONTENT, "pdf", 1);
    openSearch.injectForeignTenant();

    List<KnowledgeHit> hits = knowledge.search(tenant, "annual leave", 10);

    assertThat(hits).isNotEmpty();
    assertThat(hits).allSatisfy(hit -> assertThat(hit.fileId()).isNotEqualTo("foreign-document"));
    assertThat(hits).allSatisfy(hit -> assertThat(hit.title()).isNotEqualTo("Foreign secret"));
  }

  @Test
  void emptyIndexReturnsAnExplicitNoAnswer() {
    UUID tenant = UUID.randomUUID();

    assertThat(knowledge.search(tenant, "annual leave", 5)).isEmpty();

    assertThat(counter("awap.knowledge.search", "backend", "hybrid")).isEqualTo(1.0);
    assertThat(counter("awap.knowledge.search.fallback", "reason", "IOException")).isZero();
  }

  @Test
  void openSearchOutageDegradesToNoHitsWithoutAFabricatedAnswer() {
    UUID tenant = UUID.randomUUID();
    UUID file = UUID.randomUUID();
    knowledge.indexDocument(tenant, file, "Leave policy", LEAVE_CONTENT, "pdf", 1);

    openSearch.down();

    assertThat(knowledge.search(tenant, "annual leave", 5)).isEmpty();
    assertThat(counter("awap.knowledge.search.fallback", "reason", "IOException")).isEqualTo(1.0);
    assertThat(knowledge.indexDocument(tenant, file, "Leave policy", LEAVE_CONTENT, "pdf", 2))
        .isZero();
    assertThat(counter("awap.knowledge.index.failures", null, null)).isEqualTo(1.0);
  }

  @Test
  void analyticsSinkOutageNeverFailsTheSearchPath() {
    UUID tenant = UUID.randomUUID();
    UUID file = UUID.randomUUID();
    knowledge.indexDocument(tenant, file, "Leave policy", LEAVE_CONTENT, "pdf", 1);
    AnalyticsService degraded =
        new AnalyticsService(
            meters,
            aggregateRepository,
            document -> {
              throw new IllegalStateException("analytics sink unavailable");
            },
            sampleRepository);

    assertThat(knowledge.search(tenant, "annual leave", 5)).isNotEmpty();
    assertThatThrownBy(
            () ->
                degraded.record(
                    tenant,
                    AnalyticsEventType.WORKFLOW_STARTED,
                    UUID.randomUUID(),
                    null,
                    "start",
                    5L))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("analytics sink unavailable");

    // The authoritative daily aggregate is written before the raw-event sink is attempted.
    assertThat(dashboards.dashboard(tenant, todayQuery()).dailyTotals())
        .singleElement()
        .satisfies(total -> assertThat(total.eventType()).isEqualTo("WORKFLOW_STARTED"));
  }

  @Test
  void malformedContentIsRejectedSafely() {
    UUID tenant = UUID.randomUUID();

    assertThat(knowledge.indexDocument(tenant, UUID.randomUUID(), "   ", "", "txt", 1)).isZero();
    assertThat(openSearch.documents()).isEmpty();

    int chunks =
        knowledge.indexDocument(tenant, UUID.randomUUID(), "Policy", "scope\u0000text", "txt", 1);
    assertThat(chunks).isEqualTo(1);
    assertThat(openSearch.documents().values())
        .allSatisfy(source -> assertThat(source.path("content").asText()).doesNotContain("\u0000"));
  }

  private AnalyticsDashboardQuery todayQuery() {
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    return AnalyticsDashboardQuery.of(today, today, "DAY", "EVENT_TYPE", 10);
  }

  private double counter(String name, String tagKey, String tagValue) {
    io.micrometer.core.instrument.search.Search search = meters.find(name);
    if (tagKey != null) {
      search = search.tag(tagKey, tagValue);
    }
    Counter counter = search.counter();
    return counter == null ? 0.0 : counter.count();
  }

  private void stubAnalyticsRepositories() {
    when(aggregateRepository.findByTenantIdAndDayAndEventType(any(), any(), any()))
        .thenAnswer(
            invocation -> {
              UUID tenant = invocation.getArgument(0);
              LocalDate day = invocation.getArgument(1);
              String eventType = invocation.getArgument(2);
              return Optional.ofNullable(aggregates.get(key(tenant, day, eventType)));
            });
    when(aggregateRepository.findByTenantIdAndDayBetweenOrderByDayAscEventTypeAsc(
            any(), any(), any()))
        .thenAnswer(
            invocation -> {
              UUID tenant = invocation.getArgument(0);
              LocalDate from = invocation.getArgument(1);
              LocalDate to = invocation.getArgument(2);
              return aggregates.values().stream()
                  .filter(aggregate -> aggregate.getTenantId().equals(tenant))
                  .filter(aggregate -> !aggregate.getDay().isBefore(from))
                  .filter(aggregate -> !aggregate.getDay().isAfter(to))
                  .sorted(
                      Comparator.comparing(AnalyticsAggregate::getDay)
                          .thenComparing(AnalyticsAggregate::getEventType))
                  .toList();
            });
    when(aggregateRepository.save(any(AnalyticsAggregate.class)))
        .thenAnswer(
            invocation -> {
              AnalyticsAggregate aggregate = invocation.getArgument(0);
              aggregates.put(
                  key(aggregate.getTenantId(), aggregate.getDay(), aggregate.getEventType()),
                  aggregate);
              return aggregate;
            });
    when(sampleRepository
            .findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
                any(), any(), any()))
        .thenAnswer(
            invocation -> {
              UUID tenant = invocation.getArgument(0);
              Instant from = invocation.getArgument(1);
              Instant to = invocation.getArgument(2);
              return samples.stream()
                  .filter(sample -> sample.getTenantId().equals(tenant))
                  .filter(sample -> !sample.getOccurredAt().isBefore(from))
                  .filter(sample -> sample.getOccurredAt().isBefore(to))
                  .sorted(Comparator.comparing(AnalyticsEventSample::getOccurredAt))
                  .toList();
            });
    when(sampleRepository.save(any(AnalyticsEventSample.class)))
        .thenAnswer(
            invocation -> {
              AnalyticsEventSample sample = invocation.getArgument(0);
              samples.add(sample);
              return sample;
            });
  }

  private static String key(UUID tenant, LocalDate day, String eventType) {
    return tenant + "|" + day + "|" + eventType;
  }

  /** Deterministic stand-in for the OpenSearch HTTP API used in PR mode. */
  private static final class FakeOpenSearch extends KnowledgeOpenSearchClient {

    private final ObjectMapper mapper;
    private final Map<String, JsonNode> documents = new ConcurrentHashMap<>();
    private volatile boolean down;
    private volatile boolean failingIndex;
    private volatile boolean injectForeignTenant;

    FakeOpenSearch(ObjectMapper mapper) {
      super(HttpClient.newHttpClient(), "http://fake-opensearch:9200", Duration.ofSeconds(1));
      this.mapper = mapper;
    }

    void down() {
      this.down = true;
    }

    void failingIndex() {
      this.failingIndex = true;
    }

    void injectForeignTenant() {
      this.injectForeignTenant = true;
    }

    Map<String, JsonNode> documents() {
      return Map.copyOf(documents);
    }

    @Override
    public Response post(String path, String body) throws IOException {
      if (down) {
        throw new IOException("connect timed out: fake OpenSearch is down");
      }
      if (path.startsWith("/_bulk")) {
        if (failingIndex) {
          return new Response(503, "{\"error\":\"unavailable\"}");
        }
        return bulk(body);
      }
      if (path.endsWith("/_search")) {
        return search(body);
      }
      throw new IOException("unexpected OpenSearch path " + path);
    }

    private Response bulk(String body) throws IOException {
      String[] lines = body.split("\n", -1);
      int indexed = 0;
      for (int line = 0; line + 1 < lines.length; line += 2) {
        if (lines[line].isBlank()) {
          break;
        }
        JsonNode action = mapper.readTree(lines[line]);
        String id = action.path("index").path("_id").asText();
        documents.put(id, mapper.readTree(lines[line + 1]));
        indexed++;
      }
      return new Response(200, "{\"errors\":false,\"indexed\":" + indexed + "}");
    }

    private Response search(String body) throws IOException {
      JsonNode request = mapper.readTree(body);
      int size = request.path("size").asInt(10);
      JsonNode knn = request.path("query").path("knn").path("embedding");
      String tenant =
          knn.isMissingNode()
              ? request
                  .path("query")
                  .path("bool")
                  .path("filter")
                  .path("term")
                  .path("tenantId")
                  .asText()
              : knn.path("filter").path("term").path("tenantId").asText();
      String query =
          request
              .path("query")
              .path("bool")
              .path("must")
              .path("multi_match")
              .path("query")
              .asText("");
      List<ScoredSource> scored = new ArrayList<>();
      for (JsonNode source : documents.values()) {
        if (!tenant.equals(source.path("tenantId").asText())) {
          continue;
        }
        double score =
            knn.isMissingNode()
                ? lexicalScore(source, query)
                : vectorScore(source, knn.path("vector"));
        if (score > 0.01) {
          scored.add(new ScoredSource(score, source));
        }
      }
      if (injectForeignTenant) {
        ObjectNode foreign = mapper.createObjectNode();
        foreign.put("tenantId", UUID.randomUUID().toString());
        foreign.put("fileId", "foreign-document");
        foreign.put("title", "Foreign secret");
        foreign.put("format", "txt");
        foreign.put("version", 1);
        foreign.put("chunkIndex", 0);
        foreign.put("content", "foreign tenant data about annual leave");
        scored.add(new ScoredSource(99.0, foreign));
      }
      scored.sort(
          Comparator.comparingDouble(ScoredSource::score)
              .reversed()
              .thenComparing(hit -> hit.source().path("fileId").asText()));
      ObjectNode response = mapper.createObjectNode();
      ArrayNode hits = response.putObject("hits").putArray("hits");
      for (ScoredSource hit : scored.subList(0, Math.min(size, scored.size()))) {
        ObjectNode node = hits.addObject();
        node.put("_score", hit.score());
        node.set("_source", hit.source());
      }
      return new Response(200, mapper.writeValueAsString(response));
    }

    private static double lexicalScore(JsonNode source, String query) {
      String lowered = query.toLowerCase(Locale.ROOT);
      if (lowered.isBlank()) {
        return 0.0;
      }
      String title = source.path("title").asText("").toLowerCase(Locale.ROOT);
      String content = source.path("content").asText("").toLowerCase(Locale.ROOT);
      double score = 0.0;
      for (String token : lowered.split("[^\\p{L}\\p{N}]+")) {
        if (token.length() < 2) {
          continue;
        }
        score += 2.0 * occurrences(title, token) + occurrences(content, token);
      }
      return score;
    }

    private static int occurrences(String haystack, String needle) {
      int count = 0;
      int from = 0;
      while ((from = haystack.indexOf(needle, from)) >= 0) {
        count++;
        from += needle.length();
      }
      return count;
    }

    private static double vectorScore(JsonNode source, JsonNode queryVector) {
      JsonNode embedding = source.path("embedding");
      if (!embedding.isArray() || queryVector.size() != embedding.size()) {
        return 0.0;
      }
      double dot = 0.0;
      double left = 0.0;
      double right = 0.0;
      for (int index = 0; index < embedding.size(); index++) {
        double query = queryVector.get(index).asDouble();
        double stored = embedding.get(index).asDouble();
        dot += query * stored;
        left += query * query;
        right += stored * stored;
      }
      if (left == 0.0 || right == 0.0) {
        return 0.0;
      }
      return Math.max(0.0, dot / Math.sqrt(left * right));
    }

    private record ScoredSource(double score, JsonNode source) {}
  }
}

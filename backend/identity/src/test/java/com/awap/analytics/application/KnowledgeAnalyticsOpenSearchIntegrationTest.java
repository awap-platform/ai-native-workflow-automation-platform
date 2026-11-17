package com.awap.analytics.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.analytics.domain.AnalyticsAggregate;
import com.awap.analytics.domain.AnalyticsEventType;
import com.awap.analytics.infrastructure.AnalyticsAggregateRepository;
import com.awap.common.knowledge.KnowledgeChunkingService;
import com.awap.common.knowledge.KnowledgeIndexProvisioner;
import com.awap.common.knowledge.KnowledgeOpenSearchClient;
import com.awap.common.knowledge.KnowledgePiiRedactor;
import com.awap.common.knowledge.KnowledgeSearchService;
import com.awap.common.knowledge.KnowledgeSearchService.KnowledgeHit;
import com.awap.common.knowledge.LocalHashEmbeddingProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Real OpenSearch end-to-end coverage for knowledge indexing plus search plus analytics (#308).
 *
 * <p>The deterministic pull-request variant is {@link KnowledgeAnalyticsE2ETest}. This class runs
 * the same seeded-document journey against a real OpenSearch container in stack mode; Docker is
 * required and the class is skipped when it is absent. Indexing is asynchronous, so every assertion
 * polls the index with a bounded timeout instead of racing the refresh interval.
 */
@Testcontainers(disabledWithoutDocker = true)
class KnowledgeAnalyticsOpenSearchIntegrationTest {

  private static final int DIMENSIONS = 64;
  private static final UUID WARM_UP_TENANT = UUID.randomUUID();
  private static final ObjectMapper MAPPER = new ObjectMapper();

  @Container
  static final GenericContainer<?> OPENSEARCH =
      new GenericContainer<>(DockerImageName.parse("opensearchproject/opensearch:2.19.0"))
          .withExposedPorts(9200)
          .withEnv("discovery.type", "single-node")
          .withEnv("DISABLE_SECURITY_PLUGIN", "true")
          .withEnv("DISABLE_INSTALL_DEMO_CONFIG", "true")
          .withEnv("action.destructive_requires_name", "false")
          .withEnv("bootstrap.memory_lock", "false")
          .withEnv("OPENSEARCH_JAVA_OPTS", "-Xms512m -Xmx512m")
          .waitingFor(
              Wait.forHttp("/_cluster/health")
                  .forPort(9200)
                  .withStartupTimeout(Duration.ofMinutes(5)));

  private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
  private final Map<String, AnalyticsAggregate> aggregates = new ConcurrentHashMap<>();
  private final AnalyticsAggregateRepository aggregateRepository =
      mock(AnalyticsAggregateRepository.class);

  private KnowledgeOpenSearchClient client;
  private KnowledgeSearchService knowledge;
  private AnalyticsService analytics;
  private AnalyticsAggregationService dashboards;
  private String index;

  @BeforeEach
  void setUp() throws Exception {
    String endpoint = "http://" + OPENSEARCH.getHost() + ":" + OPENSEARCH.getMappedPort(9200);
    client =
        new KnowledgeOpenSearchClient(
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build(),
            endpoint,
            Duration.ofSeconds(10));
    applyTemplate();
    index = "awap-knowledge-e2e-" + UUID.randomUUID().toString().replace("-", "");
    knowledge =
        new KnowledgeSearchService(
            client,
            new KnowledgeChunkingService(),
            MAPPER,
            meters,
            index,
            new LocalHashEmbeddingProvider(DIMENSIONS),
            new KnowledgePiiRedactor());
    // Indexing auto-creates the index with the template mapping and refreshes it. The bounded poll
    // replaces a fragile sleep and proves the mapping accepted the kNN vector field.
    knowledge.indexDocument(
        WARM_UP_TENANT, UUID.randomUUID(), "Warm up", "warm up document", "txt", 1);
    assertThat(awaitHits(WARM_UP_TENANT, "warm", Duration.ofSeconds(30)))
        .withFailMessage("the knowledge index was not refreshed in time")
        .isNotEmpty();
    stubAggregates();
    analytics = new AnalyticsService(meters, aggregateRepository, null, null);
    dashboards = new AnalyticsAggregationService(aggregateRepository, null);
  }

  @Test
  @Timeout(180)
  void seededDocumentBecomesSearchableAndFeedsTheAnalyticsAggregate() throws Exception {
    UUID tenant = UUID.randomUUID();
    UUID file = UUID.randomUUID();
    String content =
        ("Employees may request annual leave through the portal. "
                + "Contact hr@example.com or +90 555 123 4567 for exceptions. ")
            .repeat(15);

    int chunks = knowledge.indexDocument(tenant, file, "Leave policy", content, "pdf", 2);

    assertThat(chunks).isGreaterThanOrEqualTo(2);
    List<KnowledgeHit> hits = awaitHits(tenant, "annual leave", Duration.ofSeconds(30));
    assertThat(hits).isNotEmpty();
    assertThat(hits).allSatisfy(hit -> assertThat(hit.fileId()).isEqualTo(file.toString()));
    assertThat(hits).allSatisfy(hit -> assertThat(hit.title()).isEqualTo("Leave policy"));
    assertThat(hits)
        .extracting(KnowledgeHit::snippet)
        .allSatisfy(snippet -> assertThat(snippet).contains("annual leave"));
    assertThat(hits)
        .extracting(KnowledgeHit::snippet)
        .allSatisfy(snippet -> assertThat(snippet).doesNotContain("hr@example.com"));
    assertThat(counter("awap.knowledge.search", "backend", "vector")).isPositive();

    String stored = searchRaw("\"tenantId\":\"" + tenant + "\"");
    assertThat(stored).contains("[email]").doesNotContain("hr@example.com");
    assertThat(stored).doesNotContain("555 123 4567");

    assertThat(awaitHits(UUID.randomUUID(), "annual leave", Duration.ofSeconds(2))).isEmpty();

    analytics.record(
        tenant, AnalyticsEventType.WORKFLOW_COMPLETED, UUID.randomUUID(), null, "knowledge", 900L);
    AnalyticsDashboard view = dashboards.dashboard(tenant, todayQuery());
    assertThat(view.dailyTotals())
        .singleElement()
        .satisfies(
            total -> {
              assertThat(total.eventType()).isEqualTo("WORKFLOW_COMPLETED");
              assertThat(total.count()).isEqualTo(1);
              assertThat(total.averageDurationMs()).isEqualTo(900L);
            });
    assertThat(view.dataCompleteness().dailyTotalsAvailable()).isTrue();
    assertThat(view.dataCompleteness().rawEventsAvailable()).isFalse();
  }

  @Test
  @Timeout(120)
  void emptyIndexReturnsNoHitsForEveryTenant() {
    assertThat(knowledge.search(UUID.randomUUID(), "annual leave", 5)).isEmpty();
  }

  private List<KnowledgeHit> awaitHits(UUID tenant, String query, Duration timeout)
      throws InterruptedException {
    long deadline = System.nanoTime() + timeout.toNanos();
    List<KnowledgeHit> hits = knowledge.search(tenant, query, 5);
    while (hits.isEmpty() && System.nanoTime() < deadline) {
      Thread.sleep(200);
      hits = knowledge.search(tenant, query, 5);
    }
    return hits;
  }

  private String searchRaw(String tenantTerm) throws Exception {
    String body = "{\"size\":10,\"query\":{\"bool\":{\"filter\":{\"term\":{" + tenantTerm + "}}}}}";
    KnowledgeOpenSearchClient.Response response = client.post("/" + index + "/_search", body);
    assertThat(response.status() / 100).isEqualTo(2);
    JsonNode parsed = MAPPER.readTree(response.body());
    return parsed.path("hits").path("hits").toString();
  }

  private void applyTemplate() throws Exception {
    String template;
    try (InputStream stream =
        KnowledgeIndexProvisioner.class.getResourceAsStream(
            "/opensearch/awap-knowledge-index-template.json")) {
      assertThat(stream).isNotNull();
      template =
          new String(stream.readAllBytes(), StandardCharsets.UTF_8)
              .replace("__SHARDS__", "1")
              .replace("__REPLICAS__", "0")
              .replace("__DIMENSIONS__", Integer.toString(DIMENSIONS));
    }
    KnowledgeOpenSearchClient.Response response =
        client.post("/_index_template/awap-knowledge-e2e-template", template);
    assertThat(response.status() / 100).withFailMessage(response.body()).isEqualTo(2);
  }

  private void stubAggregates() {
    when(aggregateRepository.findByTenantIdAndDayAndEventType(any(), any(), any()))
        .thenAnswer(
            invocation -> {
              UUID tenant = invocation.getArgument(0);
              LocalDate day = invocation.getArgument(1);
              String eventType = invocation.getArgument(2);
              return Optional.ofNullable(aggregates.get(tenant + "|" + day + "|" + eventType));
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
                  aggregate.getTenantId()
                      + "|"
                      + aggregate.getDay()
                      + "|"
                      + aggregate.getEventType(),
                  aggregate);
              return aggregate;
            });
  }

  private double counter(String name, String tagKey, String tagValue) {
    Counter counter = meters.find(name).tag(tagKey, tagValue).counter();
    return counter == null ? 0.0 : counter.count();
  }

  private AnalyticsDashboardQuery todayQuery() {
    LocalDate today = LocalDate.now(ZoneOffset.UTC);
    return AnalyticsDashboardQuery.of(today, today, "DAY", "EVENT_TYPE", 10);
  }
}

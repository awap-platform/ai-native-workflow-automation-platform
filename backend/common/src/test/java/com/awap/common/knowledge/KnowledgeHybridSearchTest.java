package com.awap.common.knowledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Hybrid lexical/vector retrieval, fusion, redaction and fallbacks (issue #293). */
class KnowledgeHybridSearchTest {

  private final UUID tenantId = UUID.randomUUID();
  private final KnowledgeOpenSearchClient client = mock(KnowledgeOpenSearchClient.class);
  private final ObjectMapper mapper = new ObjectMapper();
  private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
  private final KnowledgePiiRedactor redactor = new KnowledgePiiRedactor();

  private KnowledgeSearchService service(EmbeddingProvider embeddings) {
    return new KnowledgeSearchService(
        client,
        new KnowledgeChunkingService(),
        mapper,
        registry,
        "awap-knowledge",
        embeddings,
        redactor);
  }

  private static KnowledgeOpenSearchClient.Response hits(String... sources) {
    StringBuilder body = new StringBuilder("{\"hits\":{\"hits\":[");
    for (int index = 0; index < sources.length; index += 1) {
      if (index > 0) {
        body.append(',');
      }
      body.append("{\"_score\":1.0,\"_source\":").append(sources[index]).append('}');
    }
    return new KnowledgeOpenSearchClient.Response(200, body.append("]}}").toString());
  }

  private static String source(String fileId, int chunkIndex, String content, UUID tenant) {
    return """
        {"tenantId":"%s","fileId":"%s","title":"%s","format":"txt","version":1,
         "chunkIndex":%d,"content":"%s"}
        """
        .formatted(tenant, fileId, fileId, chunkIndex, content);
  }

  @Test
  void lexicalAndVectorResultsFuseWithReciprocalRankFusion() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(
            hits(
                source("a", 0, "leave policy", tenantId), source("b", 0, "annual leave", tenantId)))
        .thenReturn(hits(source("b", 0, "annual leave", tenantId)));

    List<KnowledgeSearchService.KnowledgeHit> results =
        service(new LocalHashEmbeddingProvider(64)).search(tenantId, "leave", 5);

    assertThat(results)
        .extracting(KnowledgeSearchService.KnowledgeHit::fileId)
        .containsExactly("b", "a");
    assertThat(results.get(0).score()).isGreaterThan(results.get(1).score());
    assertThat(registry.get("awap.knowledge.search").tag("backend", "hybrid").counter().count())
        .isEqualTo(1.0);
  }

  @Test
  void aSemanticVectorHitWithoutLexicalOverlapIsReturned() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(hits())
        .thenReturn(hits(source("semantic", 2, "policy", tenantId)));

    List<KnowledgeSearchService.KnowledgeHit> results =
        service(new LocalHashEmbeddingProvider(64)).search(tenantId, "leave", 5);

    assertThat(results)
        .extracting(KnowledgeSearchService.KnowledgeHit::fileId)
        .containsExactly("semantic");
    assertThat(registry.get("awap.knowledge.search").tag("backend", "vector").counter().count())
        .isEqualTo(1.0);
  }

  @Test
  void foreignHitsAreDroppedFromBothBranches() throws Exception {
    UUID other = UUID.randomUUID();
    when(client.post(anyString(), anyString()))
        .thenReturn(hits(source("foreign", 0, "x", other), source("own", 0, "x", tenantId)))
        .thenReturn(hits(source("foreign-vector", 0, "x", other)));

    List<KnowledgeSearchService.KnowledgeHit> results =
        service(new LocalHashEmbeddingProvider(64)).search(tenantId, "x", 5);

    assertThat(results)
        .extracting(KnowledgeSearchService.KnowledgeHit::fileId)
        .containsExactly("own");
  }

  @Test
  void anInvalidVectorFallsBackToLexical() throws Exception {
    when(client.post(anyString(), anyString())).thenReturn(hits(source("own", 0, "x", tenantId)));

    List<KnowledgeSearchService.KnowledgeHit> results =
        service(new FakeEmbeddings(64, new float[] {1.0f})).search(tenantId, "x", 5);

    assertThat(results).hasSize(1);
    assertThat(
            registry
                .get("awap.knowledge.search.vector_fallback")
                .tag("reason", "invalid-vector")
                .counter()
                .count())
        .isEqualTo(1.0);
    verify(client, times(1)).post(anyString(), anyString());
  }

  @Test
  void aNonFiniteVectorFallsBackToLexical() throws Exception {
    when(client.post(anyString(), anyString())).thenReturn(hits(source("own", 0, "x", tenantId)));
    float[] vector = new float[64];
    vector[0] = Float.NaN;

    List<KnowledgeSearchService.KnowledgeHit> results =
        service(new FakeEmbeddings(64, vector)).search(tenantId, "x", 5);

    assertThat(results).hasSize(1);
    assertThat(
            registry
                .get("awap.knowledge.search.vector_fallback")
                .tag("reason", "invalid-vector")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void anEmbeddingFailureFallsBackToLexical() throws Exception {
    when(client.post(anyString(), anyString())).thenReturn(hits(source("own", 0, "x", tenantId)));

    List<KnowledgeSearchService.KnowledgeHit> results =
        service(new FakeEmbeddings(64, null, new IllegalStateException("down")))
            .search(tenantId, "x", 5);

    assertThat(results).hasSize(1);
    assertThat(
            registry
                .get("awap.knowledge.search.vector_fallback")
                .tag("reason", "embedding-error")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void aZeroVectorFallsBackToLexical() throws Exception {
    when(client.post(anyString(), anyString())).thenReturn(hits(source("own", 0, "x", tenantId)));

    List<KnowledgeSearchService.KnowledgeHit> results =
        service(new FakeEmbeddings(64, new float[64])).search(tenantId, "!!!", 5);

    assertThat(results).hasSize(1);
    assertThat(
            registry
                .get("awap.knowledge.search.vector_fallback")
                .tag("reason", "empty-vector")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void aVectorEndpointFailureFallsBackToLexical() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(hits(source("own", 0, "x", tenantId)))
        .thenReturn(new KnowledgeOpenSearchClient.Response(503, "down"));

    List<KnowledgeSearchService.KnowledgeHit> results =
        service(new LocalHashEmbeddingProvider(64)).search(tenantId, "x", 5);

    assertThat(results).hasSize(1);
    assertThat(
            registry
                .get("awap.knowledge.search.vector_fallback")
                .tag("reason", "status")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void indexingRedactsPiiAndStoresTheEmbeddingVersion() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));
    KnowledgeSearchService service = service(new LocalHashEmbeddingProvider(64));

    int chunks =
        service.indexDocument(
            tenantId,
            UUID.randomUUID(),
            "Contact jane@example.com",
            "Call +905551112233 or email jane@example.com about leave.",
            "txt",
            1);

    ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
    verify(client).post(eq("/_bulk?refresh=true"), body.capture());
    assertThat(chunks).isEqualTo(1);
    assertThat(body.getValue())
        .contains("[email]")
        .contains("[phone]")
        .doesNotContain("jane@example.com")
        .doesNotContain("+905551112233")
        .contains("\"embeddingModel\":\"local-hash\"")
        .contains("\"embeddingVersion\":\"v1\"")
        .contains("\"embedding\":[");
  }

  @Test
  void indexingWithoutAnEmbeddingStillWritesTheChunk() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));
    KnowledgeSearchService service =
        service(new FakeEmbeddings(64, null, new IllegalStateException("down")));

    int chunks = service.indexDocument(tenantId, UUID.randomUUID(), "title", "content", "txt", 1);

    ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
    verify(client).post(eq("/_bulk?refresh=true"), body.capture());
    assertThat(chunks).isEqualTo(1);
    assertThat(body.getValue()).contains("\"content\":\"content\"").doesNotContain("embedding");
    assertThat(
            registry
                .get("awap.knowledge.embedding.failures")
                .tag("reason", "provider")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void anInvalidIndexVectorIsCountedAndOmitted() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));
    KnowledgeSearchService service = service(new FakeEmbeddings(64, new float[] {1.0f}));

    service.indexDocument(tenantId, UUID.randomUUID(), "title", "content", "txt", 1);

    ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
    verify(client).post(eq("/_bulk?refresh=true"), body.capture());
    assertThat(body.getValue()).doesNotContain("embedding");
    assertThat(
            registry
                .get("awap.knowledge.embedding.failures")
                .tag("reason", "invalid")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void anIndexTransportFailureStillReturnsZeroChunks() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new IOException("down"));

    assertThat(
            service(new LocalHashEmbeddingProvider(64))
                .indexDocument(tenantId, UUID.randomUUID(), "t", "content", "txt", 1))
        .isZero();
  }

  private static final class FakeEmbeddings implements EmbeddingProvider {
    private final int dimensions;
    private final float[] vector;
    private final RuntimeException failure;

    FakeEmbeddings(int dimensions, float[] vector) {
      this(dimensions, vector, null);
    }

    FakeEmbeddings(int dimensions, float[] vector, RuntimeException failure) {
      this.dimensions = dimensions;
      this.vector = vector;
      this.failure = failure;
    }

    @Override
    public String id() {
      return "fake";
    }

    @Override
    public String version() {
      return "v1";
    }

    @Override
    public int dimensions() {
      return dimensions;
    }

    @Override
    public float[] embed(String text) {
      if (failure != null) {
        throw failure;
      }
      return vector;
    }
  }
}

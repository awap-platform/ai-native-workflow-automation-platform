package com.awap.common.knowledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Mutation-hardening assertions for the tenant filter and PII redaction paths (issue #308).
 *
 * <p>The end-to-end suite proves the behaviour; these focused assertions make every branch of the
 * security-relevant search/index code observable to PIT, so a mutated tenant check, score fusion or
 * redaction cannot survive.
 */
class KnowledgeSecurityMutationTest {

  private final UUID tenantId = UUID.randomUUID();
  private final KnowledgeOpenSearchClient client = mock(KnowledgeOpenSearchClient.class);
  private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
  private final ObjectMapper mapper = new ObjectMapper();
  private final KnowledgeSearchService service =
      new KnowledgeSearchService(
          client,
          new KnowledgeChunkingService(),
          mapper,
          registry,
          "awap-knowledge",
          new LocalHashEmbeddingProvider(64),
          new KnowledgePiiRedactor());

  @Test
  void successfulIndexingCountsEveryStoredChunk() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));

    int chunks = service.indexDocument(tenantId, UUID.randomUUID(), "Policy", "content", "txt", 1);

    assertThat(chunks).isEqualTo(1);
    assertThat(counter("awap.knowledge.index.chunks", "success")).isEqualTo(1.0);
  }

  @Test
  void aRejectedBulkResponseReturnsZeroAndCountsTheFailure() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(500, "{\"error\":\"boom\"}"));

    int chunks = service.indexDocument(tenantId, UUID.randomUUID(), "Policy", "content", "txt", 1);

    assertThat(chunks).isZero();
    assertThat(counter("awap.knowledge.index.chunks", "failure")).isEqualTo(1.0);
  }

  @Test
  void anInterruptedIndexCountsTheFailureAndRestoresTheFlag() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new InterruptedException("stop"));
    try {
      assertThat(service.indexDocument(tenantId, UUID.randomUUID(), "Policy", "content", "txt", 1))
          .isZero();
      assertThat(registry.get("awap.knowledge.index.failures").counter().count()).isEqualTo(1.0);
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void anInterruptedSearchCountsTheFallbackReason() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new InterruptedException("stop"));
    try {
      assertThat(service.search(tenantId, "leave", 5)).isEmpty();
      assertThat(
              registry
                  .get("awap.knowledge.search.fallback")
                  .tag("reason", "InterruptedException")
                  .counter()
                  .count())
          .isEqualTo(1.0);
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void aTransportFailureCountsTheFallbackReason() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new IOException("down"));

    assertThat(service.search(tenantId, "leave", 5)).isEmpty();

    assertThat(
            registry
                .get("awap.knowledge.search.fallback")
                .tag("reason", "IOException")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void aRejectedLexicalStatusIsARecoverableFailure() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(500, "{}"));

    assertThat(service.search(tenantId, "leave", 5)).isEmpty();

    assertThat(
            registry
                .get("awap.knowledge.search.fallback")
                .tag("reason", "IllegalStateException")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void fusedScoresAreTheExactReciprocalRankSum() throws Exception {
    String lexical =
        """
        {"hits":{"hits":[
          {"_score":2.0,"_source":{"tenantId":"%s","fileId":"f","title":"A","format":"txt",
           "version":1,"chunkIndex":0,"content":"leave policy"}},
          {"_score":1.0,"_source":{"tenantId":"%s","fileId":"g","title":"B","format":"txt",
           "version":1,"chunkIndex":0,"content":"leave rule"}}
        ]}}
        """
            .formatted(tenantId, tenantId);
    String vector =
        """
        {"hits":{"hits":[
          {"_score":0.9,"_source":{"tenantId":"%s","fileId":"f","title":"A","format":"txt",
           "version":1,"chunkIndex":0,"content":"leave policy"}}
        ]}}
        """
            .formatted(tenantId);
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, lexical))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, vector));

    List<KnowledgeSearchService.KnowledgeHit> hits = service.search(tenantId, "leave", 5);

    assertThat(hits)
        .extracting(KnowledgeSearchService.KnowledgeHit::fileId)
        .containsExactly("f", "g");
    assertThat(hits.get(0).score()).isEqualTo(2.0 / 61.0);
    assertThat(hits.get(1).score()).isEqualTo(1.0 / 62.0);
  }

  @Test
  void snippetWindowStartsAtTheQueryAndFallsBackToTheFirstCharacters() throws Exception {
    String atStart =
        """
        {"hits":{"hits":[
          {"_score":1.0,"_source":{"tenantId":"%s","fileId":"f","title":"A","format":"txt",
           "version":1,"chunkIndex":0,"content":"needle%s"}}
        ]}}
        """
            .formatted(tenantId, "x".repeat(500));
    String shortContent =
        """
        {"hits":{"hits":[
          {"_score":1.0,"_source":{"tenantId":"%s","fileId":"f","title":"A","format":"txt",
           "version":1,"chunkIndex":0,"content":"%s"}}
        ]}}
        """
            .formatted(tenantId, "y".repeat(200));
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, atStart))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{\"hits\":{\"hits\":[]}}"));

    List<KnowledgeSearchService.KnowledgeHit> hits = service.search(tenantId, "needle", 5);

    assertThat(hits).singleElement().satisfies(hit -> assertThat(hit.snippet()).hasSize(226));
    assertThat(hits.get(0).snippet()).startsWith("needle");

    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, shortContent))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{\"hits\":{\"hits\":[]}}"));

    List<KnowledgeSearchService.KnowledgeHit> fallback = service.search(tenantId, "absent", 5);

    assertThat(fallback).singleElement().satisfies(hit -> assertThat(hit.snippet()).hasSize(200));
  }

  @Test
  void aHitWithoutATenantIdentifierIsDropped() throws Exception {
    String body =
        """
        {"hits":{"hits":[
          {"_score":9.0,"_source":{"fileId":"unscoped","title":"Missing","format":"txt",
           "version":1,"chunkIndex":0,"content":"leave"}}
        ]}}
        """;
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, body));

    assertThat(service.search(tenantId, "leave", 5)).isEmpty();
  }

  @Test
  void phoneOnlyPiiIsDetectedAndMasked() {
    KnowledgePiiRedactor redactor = new KnowledgePiiRedactor();

    assertThat(redactor.containsPii("Call 555 123 4567 now")).isTrue();
    assertThat(redactor.redact("Call 555 123 4567 now"))
        .contains("[phone]")
        .doesNotContain("555 123 4567");
    assertThat(redactor.containsPii("Policy text only")).isFalse();
  }

  @Test
  void bulkEntriesUseTheDeterministicChunkIdentifier() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));
    UUID fileId = UUID.randomUUID();

    service.indexDocument(tenantId, fileId, "Policy", "content", "txt", 7);

    ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
    verify(client).post(eq("/_bulk?refresh=true"), body.capture());
    assertThat(body.getValue())
        .contains("\"_id\":\"" + fileId + "-7-0\"")
        .contains("\"tenantId\":\"" + tenantId + "\"");
  }

  private double counter(String name, String outcome) {
    return registry.get(name).tag("outcome", outcome).counter().count();
  }
}

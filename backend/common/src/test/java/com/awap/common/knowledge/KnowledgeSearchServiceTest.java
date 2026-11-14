package com.awap.common.knowledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Tenant-scoped knowledge search and indexing. */
class KnowledgeSearchServiceTest {

  private final UUID tenantId = UUID.randomUUID();
  private final KnowledgeOpenSearchClient client = mock(KnowledgeOpenSearchClient.class);
  private final KnowledgeSearchService service =
      new KnowledgeSearchService(
          client,
          new KnowledgeChunkingService(),
          new ObjectMapper(),
          new SimpleMeterRegistry(),
          "awap-knowledge");

  @Test
  void searchReturnsOnlyTheCallersTenantChunks() throws Exception {
    String body =
        """
        {"hits":{"hits":[
          {"_score":1.5,"_source":{"tenantId":"%s","fileId":"file-1","title":"Leave policy",
           "format":"pdf","version":2,"chunkIndex":0,"content":"Employees may request leave."}},
          {"_score":9.0,"_source":{"tenantId":"%s","fileId":"foreign","title":"Secret",
           "format":"pdf","version":1,"chunkIndex":0,"content":"foreign tenant data"}}
        ]}}
        """
            .formatted(tenantId, UUID.randomUUID());
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, body));

    List<KnowledgeSearchService.KnowledgeHit> hits = service.search(tenantId, "leave", 10);

    assertThat(hits).hasSize(1);
    assertThat(hits.get(0).title()).isEqualTo("Leave policy");
    assertThat(hits.get(0).snippet()).contains("request leave");
  }

  @Test
  void aHitWithoutTheQueryStillReturnsAForcedSnippet() throws Exception {
    String body =
        """
        {"hits":{"hits":[
          {"_score":1.0,"_source":{"tenantId":"%s","fileId":"file-2","title":"Policy",
           "format":"txt","version":1,"chunkIndex":0,"content":"%s"}}
        ]}}
        """
            .formatted(tenantId, "x".repeat(400));
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, body));

    List<KnowledgeSearchService.KnowledgeHit> hits = service.search(tenantId, "absent", 10);

    assertThat(hits).hasSize(1);
    assertThat(hits.get(0).snippet()).hasSize(300);
  }

  @Test
  void aHitWithoutContentYieldsAnEmptySnippet() throws Exception {
    String body =
        """
        {"hits":{"hits":[
          {"_score":1.0,"_source":{"tenantId":"%s","fileId":"file-3","format":"txt",
           "version":1,"chunkIndex":0,"content":""}}
        ]}}
        """
            .formatted(tenantId);
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, body));

    List<KnowledgeSearchService.KnowledgeHit> hits = service.search(tenantId, "leave", 10);

    assertThat(hits).hasSize(1);
    assertThat(hits.get(0).title()).isEqualTo("file-3");
    assertThat(hits.get(0).snippet()).isEmpty();
  }

  @Test
  void openSearchOutageReturnsNoHitsInsteadOfFailingTheCaller() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new IOException("down"));

    assertThat(service.search(tenantId, "leave", 10)).isEmpty();
  }

  @Test
  void aNonSuccessStatusAlsoFallsBackToNoHits() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(503, "unavailable"));

    assertThat(service.search(tenantId, "leave", 10)).isEmpty();
  }

  @Test
  void anInterruptedSearchReturnsNoHitsAndRestoresTheInterruptFlag() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new InterruptedException("stop"));
    try {
      assertThat(service.search(tenantId, "leave", 10)).isEmpty();
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void anInterruptedIndexRestoresTheInterruptFlag() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new InterruptedException("stop"));
    try {
      assertThat(service.indexDocument(tenantId, UUID.randomUUID(), "t", "content", "txt", 1))
          .isZero();
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void blankQuerySkipsOpenSearch() {
    assertThat(service.search(tenantId, " ", 10)).isEmpty();
    assertThat(service.search(tenantId, null, 10)).isEmpty();
  }

  @Test
  void indexingChunksTheDocumentAndCountsSuccess() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));

    int chunks =
        service.indexDocument(
            tenantId, UUID.randomUUID(), "policy.txt", "Annual leave policy.", "txt", 1);

    assertThat(chunks).isEqualTo(1);
  }

  @Test
  void indexingFallsBackToTheTitleWhenContentIsBlank() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));

    int chunks = service.indexDocument(tenantId, UUID.randomUUID(), "Policy title", "", "txt", 1);

    assertThat(chunks).isEqualTo(1);
  }

  @Test
  void indexingAnEmptyDocumentWritesAnEmptyBulkRequest() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));

    int chunks = service.indexDocument(tenantId, UUID.randomUUID(), null, null, null, 1);

    assertThat(chunks).isZero();
  }

  @Test
  void aRejectedBulkRequestReportsZeroIndexedChunks() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(500, "boom"));

    assertThat(service.indexDocument(tenantId, UUID.randomUUID(), "t", "content", "txt", 1))
        .isZero();
  }

  @Test
  void indexingFailuresAreSwallowedAndCounted() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new IOException("down"));

    assertThat(service.indexDocument(tenantId, UUID.randomUUID(), "t", "content", "txt", 1))
        .isZero();
  }
}

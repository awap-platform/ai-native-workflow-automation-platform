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
  void openSearchOutageReturnsNoHitsInsteadOfFailingTheCaller() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new IOException("down"));

    assertThat(service.search(tenantId, "leave", 10)).isEmpty();
  }

  @Test
  void blankQuerySkipsOpenSearch() {
    assertThat(service.search(tenantId, " ", 10)).isEmpty();
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
}

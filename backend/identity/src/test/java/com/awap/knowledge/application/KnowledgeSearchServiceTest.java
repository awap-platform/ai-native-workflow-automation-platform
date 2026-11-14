package com.awap.knowledge.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import com.awap.document.application.DocumentService;
import com.awap.document.domain.DocumentVersion;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

class KnowledgeSearchServiceTest {

  private final UUID tenantId = UUID.randomUUID();

  @Test
  void fallsBackToTenantDocumentMetadataWhenOpenSearchIsUnavailable() {
    DocumentService documentService = mock(DocumentService.class);
    DocumentVersion document = mock(DocumentVersion.class);
    when(document.getFileId()).thenReturn(UUID.randomUUID());
    when(document.getObjectKey()).thenReturn("leave-policy.pdf");
    when(document.getFormat()).thenReturn("pdf");
    when(documentService.list(tenantId)).thenReturn(List.of(document));

    @SuppressWarnings("unchecked")
    ObjectProvider<OpenSearchTransport> provider = mock(ObjectProvider.class);
    when(provider.getIfAvailable()).thenReturn(null);

    KnowledgeSearchService service =
        new KnowledgeSearchService(
            provider,
            documentService,
            new KnowledgeChunkingService(),
            new ObjectMapper(),
            new SimpleMeterRegistry(),
            "awap-knowledge");

    List<KnowledgeSearchService.KnowledgeHit> hits =
        service.search(tenantId, "izin politikası belge ara", 10);

    assertThat(hits).hasSize(1);
    assertThat(hits.get(0).title()).isEqualTo("leave-policy.pdf");
    assertThat(hits.get(0).format()).isEqualTo("pdf");
  }
}

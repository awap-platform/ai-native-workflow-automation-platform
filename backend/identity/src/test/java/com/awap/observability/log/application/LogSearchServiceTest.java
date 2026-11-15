package com.awap.observability.log.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.analytics.infrastructure.opensearch.OpenSearchResponse;
import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

class LogSearchServiceTest {

  private static final UUID TENANT = UUID.randomUUID();
  private static final String HIT =
      """
      {"hits":{"total":{"value":1},"hits":[{"_source":{
        "tenantId":"%s","service":"ai-layer","level":"INFO","logger":"awap.test",
        "message":"contact ada@example.com","correlationId":"corr-1","traceId":"trace-1",
        "timestamp":"2026-11-15T10:00:00Z"}}]}}
      """
          .formatted(TENANT);

  @SuppressWarnings("unchecked")
  private ObjectProvider<OpenSearchTransport> provider(OpenSearchTransport transport) {
    ObjectProvider<OpenSearchTransport> provider = mock(ObjectProvider.class);
    when(provider.getIfAvailable()).thenReturn(transport);
    return provider;
  }

  @Test
  void searchesWithATenantFilterAndRedactsTheMessage() {
    FakeTransport transport = new FakeTransport(HIT);
    LogSearchService service =
        new LogSearchService(provider(transport), new ObjectMapper(), "awap-logs");

    LogSearchResult result = service.search(TENANT, LogSearchQuery.of("CORR-1", null, null, 10));

    assertThat(result.available()).isTrue();
    assertThat(result.total()).isEqualTo(1);
    assertThat(result.logs()).hasSize(1);
    assertThat(result.logs().getFirst().tenantId()).isEqualTo(TENANT.toString());
    assertThat(result.logs().getFirst().message()).isEqualTo("contact [REDACTED]");
    assertThat(transport.path).isEqualTo("/awap-logs-*/_search");
    assertThat(transport.requestBody)
        .contains("\"tenantId\":\"" + TENANT + "\"")
        .contains("\"correlationId\":\"corr-1\"")
        .contains("\"size\":10");
  }

  @Test
  void reportsUnavailableWhenNoTransportExists() {
    @SuppressWarnings("unchecked")
    ObjectProvider<OpenSearchTransport> empty = mock(ObjectProvider.class);
    when(empty.getIfAvailable()).thenReturn(null);

    LogSearchService service = new LogSearchService(empty, new ObjectMapper(), "awap-logs");

    LogSearchResult result = service.search(TENANT, LogSearchQuery.of(null, null, null, null));

    assertThat(result.available()).isFalse();
    assertThat(result.logs()).isEmpty();
  }

  @Test
  void reportsUnavailableForAnErrorStatusOrTransportFailure() throws Exception {
    LogSearchService error =
        new LogSearchService(
            provider(new FakeTransport(new OpenSearchResponse(503, "{}"))),
            new ObjectMapper(),
            "awap-logs");
    assertThat(error.search(TENANT, LogSearchQuery.of(null, null, null, null)).available())
        .isFalse();

    LogSearchService io =
        new LogSearchService(
            provider(new FailingTransport(new IOException("down"))),
            new ObjectMapper(),
            "awap-logs");
    assertThat(io.search(TENANT, LogSearchQuery.of(null, null, null, null)).available()).isFalse();

    LogSearchService interrupted =
        new LogSearchService(
            provider(new FailingTransport(new InterruptedException("stop"))),
            new ObjectMapper(),
            "awap-logs");
    assertThat(interrupted.search(TENANT, LogSearchQuery.of(null, null, null, null)).available())
        .isFalse();
  }

  @Test
  void skipsNonObjectHitsAndFallsBackToEpochForAnInvalidTimestamp() throws Exception {
    FakeTransport transport =
        new FakeTransport(
            """
            {"hits":{"total":{"value":2},"hits":[
              {"_source":{"tenantId":"t","message":"one","timestamp":"bad"}},
              {"_source":"not-an-object"}
            ]}}
            """);
    LogSearchService service =
        new LogSearchService(provider(transport), new ObjectMapper(), "awap-logs");

    LogSearchResult result = service.search(TENANT, LogSearchQuery.of(null, null, null, null));

    assertThat(result.total()).isEqualTo(2);
    assertThat(result.logs()).hasSize(1);
    assertThat(result.logs().getFirst().timestamp().toString()).isEqualTo("1970-01-01T00:00:00Z");
    assertThat(transport.body).doesNotContain("\"correlationId\"");
  }

  private static final class FakeTransport implements OpenSearchTransport {
    private final int status;
    private final String body;
    private String path;
    private String requestBody;

    FakeTransport(String body) {
      this.status = 200;
      this.body = body;
    }

    FakeTransport(OpenSearchResponse response) {
      this.status = response.status();
      this.body = response.body();
    }

    @Override
    public OpenSearchResponse execute(String method, String path, String body) {
      this.path = path;
      this.requestBody = body;
      return new OpenSearchResponse(status, this.body);
    }
  }

  private static final class FailingTransport implements OpenSearchTransport {
    private final Exception failure;

    FailingTransport(Exception failure) {
      this.failure = failure;
    }

    @Override
    public OpenSearchResponse execute(String method, String path, String body)
        throws IOException, InterruptedException {
      if (failure instanceof IOException io) {
        throw io;
      }
      throw (InterruptedException) failure;
    }
  }
}

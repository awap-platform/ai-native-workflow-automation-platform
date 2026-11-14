package com.awap.common.knowledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Transport contract for the shared OpenSearch client. */
class KnowledgeOpenSearchClientTest {

  private final HttpClient httpClient = mock(HttpClient.class);

  @Test
  void postsJsonAndMapsTheResponse() throws Exception {
    respond(201, "{\"ok\":true}");
    KnowledgeOpenSearchClient client =
        new KnowledgeOpenSearchClient(httpClient, "http://os.local", Duration.ofSeconds(2));

    KnowledgeOpenSearchClient.Response response = client.post("/_search", "{\"query\":1}");

    assertThat(response.status()).isEqualTo(201);
    assertThat(response.body()).isEqualTo("{\"ok\":true}");
    HttpRequest sent = capturedRequest();
    assertThat(sent.method()).isEqualTo("POST");
    assertThat(sent.uri().toString()).isEqualTo("http://os.local/_search");
    assertThat(sent.headers().firstValue("Content-Type")).contains("application/json");
    assertThat(sent.bodyPublisher()).isPresent();
  }

  @Test
  void trimsATrailingSlashAndSendsAnEmptyBodyWithoutContentType() throws Exception {
    respond(200, "{}");
    KnowledgeOpenSearchClient client =
        new KnowledgeOpenSearchClient(httpClient, "http://os.local/", Duration.ofSeconds(2));

    client.post("/_bulk", null);

    HttpRequest sent = capturedRequest();
    assertThat(sent.uri().toString()).isEqualTo("http://os.local/_bulk");
    assertThat(sent.headers().firstValue("Content-Type")).isEmpty();
    assertThat(sent.bodyPublisher()).isPresent();
  }

  @Test
  void theAutowiredConstructorIsUsableWithRealConfigurationValues() {
    KnowledgeOpenSearchClient client = new KnowledgeOpenSearchClient("http://localhost:9200", 0, 0);

    assertThat(client).isNotNull();
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  private void respond(int status, String body) throws Exception {
    HttpResponse<String> response = mock(HttpResponse.class);
    doReturn(status).when(response).statusCode();
    doReturn(body).when(response).body();
    doReturn(response).when(httpClient).send(any(), any());
  }

  @SuppressWarnings("rawtypes")
  private HttpRequest capturedRequest() throws Exception {
    ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
    org.mockito.Mockito.verify(httpClient).send(captor.capture(), any());
    return captor.getValue();
  }
}

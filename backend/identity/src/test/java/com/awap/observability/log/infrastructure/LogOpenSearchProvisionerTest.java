package com.awap.observability.log.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.analytics.infrastructure.opensearch.OpenSearchResponse;
import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

class LogOpenSearchProvisionerTest {

  private final RecordingLogTransport transport = new RecordingLogTransport();
  private final SimpleMeterRegistry meters = new SimpleMeterRegistry();

  @SuppressWarnings("unchecked")
  private ObjectProvider<OpenSearchTransport> provider(OpenSearchTransport value) {
    ObjectProvider<OpenSearchTransport> provider = mock(ObjectProvider.class);
    when(provider.getIfAvailable()).thenReturn(value);
    return provider;
  }

  private LogOpenSearchProvisioner provisioner(ObjectProvider<OpenSearchTransport> provider) {
    return new LogOpenSearchProvisioner(provider, new ObjectMapper(), meters, "awap-logs", 7, 90);
  }

  @Test
  void provisionsTheLogTemplateAndRetentionPolicy() {
    assertThat(provisioner(provider(transport)).provision()).isTrue();

    assertThat(transport.requests()).hasSize(2);
    assertThat(transport.requests().get(0).path())
        .isEqualTo("/_plugins/_ism/policies/awap-logs-ism");
    assertThat(transport.requests().get(0).body())
        .contains("\"min_index_age\":\"7d\"")
        .contains("\"min_index_age\":\"90d\"")
        .contains("\"index_patterns\":[\"awap-logs-*\"]");
    assertThat(transport.requests().get(1).path()).isEqualTo("/_index_template/awap-logs-template");
    assertThat(transport.requests().get(1).body())
        .contains("\"dynamic\":\"strict\"")
        .contains("\"correlationId\":{\"type\":\"keyword\"}")
        .contains("\"traceId\":{\"type\":\"keyword\"}");
    assertThat(
            meters
                .get("awap.logs.provisioning")
                .tags("component", "log_ism_policy", "outcome", "success")
                .counter()
                .count())
        .isEqualTo(1d);
  }

  @Test
  void treatsConflictAsSuccessAndReportsRejections() {
    RecordingLogTransport conflict = new RecordingLogTransport();
    conflict.respondWith(new OpenSearchResponse(409, "{}"));
    conflict.respondWith(new OpenSearchResponse(409, "{}"));
    assertThat(provisioner(provider(conflict)).provision()).isTrue();

    RecordingLogTransport rejected = new RecordingLogTransport();
    rejected.respondWith(new OpenSearchResponse(500, "{}"));
    rejected.respondWith(new OpenSearchResponse(500, "{}"));
    assertThat(provisioner(provider(rejected)).provision()).isFalse();
  }

  @Test
  void reportsUnavailableWhenTheTransportIsMissing() {
    @SuppressWarnings("unchecked")
    ObjectProvider<OpenSearchTransport> empty = mock(ObjectProvider.class);
    when(empty.getIfAvailable()).thenReturn(null);

    LogOpenSearchProvisioner provisioner = provisioner(empty);

    assertThat(provisioner.provision()).isFalse();
    provisioner.provisionOnStartup();
  }
}

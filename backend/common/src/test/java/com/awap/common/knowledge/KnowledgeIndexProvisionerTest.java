package com.awap.common.knowledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Knowledge index template and ISM provisioning (issue #293). */
class KnowledgeIndexProvisionerTest {

  private final KnowledgeOpenSearchClient client = mock(KnowledgeOpenSearchClient.class);
  private final SimpleMeterRegistry registry = new SimpleMeterRegistry();

  private KnowledgeIndexProvisioner provisioner() {
    return new KnowledgeIndexProvisioner(client, registry, 2, 0, 384);
  }

  @Test
  void provisionsTheTemplateAndPolicyWithConfiguredValues() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));

    assertThat(provisioner().provision()).isTrue();

    ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
    verify(client, times(2)).post(anyString(), body.capture());
    assertThat(body.getAllValues().get(0))
        .contains("\"number_of_shards\": 2")
        .contains("\"number_of_replicas\": 0")
        .contains("\"dimension\": 384")
        .contains("knn_vector");
    assertThat(body.getAllValues().get(1)).contains("min_index_age").contains("awap-knowledge*");
    verify(client).post(eq(KnowledgeIndexProvisioner.TEMPLATE_PATH), anyString());
    verify(client).post(eq(KnowledgeIndexProvisioner.ISM_PATH), anyString());
  }

  @Test
  void aNonSuccessStatusIsReportedAsFailure() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(500, "boom"))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));

    assertThat(provisioner().provision()).isFalse();
    assertThat(
            registry
                .get("awap.knowledge.index.provision")
                .tag("component", "template")
                .tag("outcome", "failure")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void transportAndInterruptFailuresAreSwallowed() throws Exception {
    when(client.post(anyString(), anyString())).thenThrow(new IOException("down"));
    assertThat(provisioner().provision()).isFalse();
    assertThat(
            registry
                .get("awap.knowledge.index.provision")
                .tag("component", "template")
                .tag("outcome", "error")
                .counter()
                .count())
        .isEqualTo(1.0);

    doThrow(new InterruptedException("stop")).when(client).post(anyString(), anyString());
    try {
      assertThat(provisioner().provision()).isFalse();
      assertThat(Thread.currentThread().isInterrupted()).isTrue();
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  void theReadyEventRunsProvisioning() throws Exception {
    when(client.post(anyString(), anyString()))
        .thenReturn(new KnowledgeOpenSearchClient.Response(200, "{}"));

    provisioner().onReady();

    verify(client, times(2)).post(anyString(), anyString());
  }

  @Test
  void aMissingResourceFailsClearly() {
    assertThatThrownBy(() -> provisioner().render("missing.json", Map.of()))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("missing.json");
  }
}

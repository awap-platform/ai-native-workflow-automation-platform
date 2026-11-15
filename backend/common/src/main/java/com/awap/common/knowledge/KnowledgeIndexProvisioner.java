package com.awap.common.knowledge;

import io.micrometer.core.instrument.MeterRegistry;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Applies the {@code awap-knowledge} index template and ISM retention policy (issue #293).
 *
 * <p>The template is versioned in source. Provisioning is idempotent and best effort: an OpenSearch
 * outage is logged and counted, and the next application start retries.
 */
@Component
public class KnowledgeIndexProvisioner {

  private static final Logger log = LoggerFactory.getLogger(KnowledgeIndexProvisioner.class);
  static final String TEMPLATE_PATH = "/_index_template/awap-knowledge-template";
  static final String ISM_PATH = "/_plugins/_ism/policies/awap-knowledge-retention";

  private final KnowledgeOpenSearchClient client;
  private final MeterRegistry meterRegistry;
  private final int shards;
  private final int replicas;
  private final int dimensions;

  @Autowired
  public KnowledgeIndexProvisioner(
      KnowledgeOpenSearchClient client,
      MeterRegistry meterRegistry,
      @Value("${awap.knowledge.index.shards:1}") int shards,
      @Value("${awap.knowledge.index.replicas:1}") int replicas,
      @Value("${awap.knowledge.embedding.dimensions:256}") int dimensions) {
    this.client = client;
    this.meterRegistry = meterRegistry;
    this.shards = shards;
    this.replicas = replicas;
    this.dimensions = dimensions;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void onReady() {
    provision();
  }

  public boolean provision() {
    Map<String, String> replacements =
        Map.of(
            "__SHARDS__", Integer.toString(Math.max(1, shards)),
            "__REPLICAS__", Integer.toString(Math.max(0, replicas)),
            "__DIMENSIONS__", Integer.toString(dimensions));
    boolean template =
        put(TEMPLATE_PATH, render("awap-knowledge-index-template.json", replacements), "template");
    boolean ism = put(ISM_PATH, render("awap-knowledge-ism-policy.json", replacements), "ism");
    return template && ism;
  }

  private boolean put(String path, String body, String component) {
    try {
      KnowledgeOpenSearchClient.Response response = client.post(path, body);
      boolean ok = response.status() / 100 == 2;
      meterRegistry
          .counter(
              "awap.knowledge.index.provision",
              "component",
              component,
              "outcome",
              ok ? "success" : "failure")
          .increment();
      if (!ok) {
        log.warn("Knowledge provisioning for {} returned status {}", component, response.status());
      }
      return ok;
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      meterRegistry
          .counter(
              "awap.knowledge.index.provision", "component", component, "outcome", "interrupted")
          .increment();
      log.warn("Knowledge provisioning for {} was interrupted", component);
      return false;
    } catch (Exception ex) {
      meterRegistry
          .counter("awap.knowledge.index.provision", "component", component, "outcome", "error")
          .increment();
      log.warn("Knowledge provisioning for {} failed: {}", component, ex.toString());
      return false;
    }
  }

  String render(String resourceName, Map<String, String> replacements) {
    try (InputStream stream =
        KnowledgeIndexProvisioner.class.getResourceAsStream("/opensearch/" + resourceName)) {
      if (stream == null) {
        throw new IOException("Missing OpenSearch resource: " + resourceName);
      }
      String body = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
      for (Map.Entry<String, String> entry : replacements.entrySet()) {
        body = body.replace(entry.getKey(), entry.getValue());
      }
      return body;
    } catch (IOException ex) {
      throw new IllegalStateException("Cannot render OpenSearch resource: " + resourceName, ex);
    }
  }
}

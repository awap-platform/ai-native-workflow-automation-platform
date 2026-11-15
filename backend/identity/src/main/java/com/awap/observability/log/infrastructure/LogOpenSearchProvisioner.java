package com.awap.observability.log.infrastructure;

import com.awap.analytics.infrastructure.opensearch.OpenSearchResponse;
import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import com.awap.observability.log.application.LogIndexNames;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Provisions the daily log index template and ISM retention policy (issue #286).
 *
 * <p>All calls are idempotent PUTs. The component is independent from the analytics provisioner so
 * log shipping can be enabled on its own once an {@link OpenSearchTransport} is available.
 */
@Component
@ConditionalOnProperty(name = "awap.logs.opensearch.enabled", havingValue = "true")
public class LogOpenSearchProvisioner {

  private static final Logger log = LoggerFactory.getLogger(LogOpenSearchProvisioner.class);

  public static final String ISM_POLICY_ID = "awap-logs-ism";
  public static final String INDEX_TEMPLATE_NAME = "awap-logs-template";

  private final ObjectProvider<OpenSearchTransport> transportProvider;
  private final ObjectMapper objectMapper;
  private final MeterRegistry meterRegistry;
  private final LogIndexNames indexNames;

  public LogOpenSearchProvisioner(
      ObjectProvider<OpenSearchTransport> transportProvider,
      ObjectMapper objectMapper,
      MeterRegistry meterRegistry,
      @Value("${awap.logs.index:awap-logs}") String indexPrefix,
      @Value("${awap.logs.retention-hot-days:7}") int hotDays,
      @Value("${awap.logs.retention-delete-days:90}") int deleteDays) {
    this.transportProvider = transportProvider;
    this.objectMapper = objectMapper;
    this.meterRegistry = meterRegistry;
    this.indexNames = new LogIndexNames(indexPrefix);
    this.hotDays = hotDays > 0 ? hotDays : 7;
    this.deleteDays = deleteDays > this.hotDays ? deleteDays : 90;
  }

  private final int hotDays;
  private final int deleteDays;

  @EventListener(ApplicationReadyEvent.class)
  public void provisionOnStartup() {
    if (!provision()) {
      log.warn("OpenSearch log provisioning was incomplete; retrying on the next restart");
    }
  }

  public boolean provision() {
    OpenSearchTransport transport = transportProvider.getIfAvailable();
    if (transport == null) {
      return false;
    }
    boolean policy =
        put(
            transport,
            "/_plugins/_ism/policies/" + ISM_POLICY_ID,
            render(
                "awap-logs-ism-policy.json",
                Map.of(
                    "{{description}}",
                    "AWAP log retention: hot " + hotDays + "d, delete " + deleteDays + "d",
                    "{{hot_days}}",
                    String.valueOf(hotDays),
                    "{{delete_days}}",
                    String.valueOf(deleteDays),
                    "{{index_pattern}}",
                    indexNames.pattern())),
            "log_ism_policy");
    boolean template =
        put(
            transport,
            "/_index_template/" + INDEX_TEMPLATE_NAME,
            render(
                "awap-logs-index-template.json",
                Map.of(
                    "{{index_pattern}}", indexNames.pattern(), "{{ism_policy_id}}", ISM_POLICY_ID)),
            "log_index_template");
    return policy && template;
  }

  private boolean put(OpenSearchTransport transport, String path, String body, String component) {
    try {
      OpenSearchResponse response = transport.execute("PUT", path, body);
      if (response.successful() || response.status() == 409) {
        increment(component, "success");
        return true;
      }
      increment(component, "failure");
      log.warn(
          "OpenSearch log provisioning call {} failed with status {}", path, response.status());
      return false;
    } catch (IOException ex) {
      increment(component, "failure");
      log.warn("OpenSearch log provisioning call {} failed: {}", path, ex.getMessage());
      return false;
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      increment(component, "failure");
      return false;
    }
  }

  private String render(String resourceName, Map<String, String> replacements) {
    try {
      String body =
          new ClassPathResource("opensearch/" + resourceName)
              .getContentAsString(StandardCharsets.UTF_8);
      for (Map.Entry<String, String> replacement : replacements.entrySet()) {
        body = body.replace(replacement.getKey(), replacement.getValue());
      }
      return objectMapper.writeValueAsString(objectMapper.readTree(body));
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException(
          "OpenSearch log provisioning file " + resourceName + " is not valid JSON", ex);
    } catch (IOException ex) {
      throw new IllegalStateException(
          "Cannot load OpenSearch log provisioning file " + resourceName, ex);
    }
  }

  private void increment(String component, String outcome) {
    meterRegistry
        .counter("awap.logs.provisioning", "component", component, "outcome", outcome)
        .increment();
  }
}

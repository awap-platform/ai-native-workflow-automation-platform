package com.awap.observability.log.application;

import com.awap.analytics.infrastructure.opensearch.OpenSearchResponse;
import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import com.awap.observability.log.domain.LogEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Tenant-scoped correlation search over the daily OpenSearch log indices (issue #286).
 *
 * <p>The {@code tenantId} term filter is always present and is never derived from user input. A
 * transport failure is reported as {@code available=false} rather than as an empty result, so a
 * dashboard cannot mistake an outage for "no logs".
 */
@Service
public class LogSearchService {

  private final ObjectProvider<OpenSearchTransport> transportProvider;
  private final ObjectMapper objectMapper;
  private final LogIndexNames indexNames;
  private final LogRedactor redactor = new LogRedactor();

  public LogSearchService(
      ObjectProvider<OpenSearchTransport> transportProvider,
      ObjectMapper objectMapper,
      @Value("${awap.logs.index:awap-logs}") String indexPrefix) {
    this.transportProvider = transportProvider;
    this.objectMapper = objectMapper;
    this.indexNames = new LogIndexNames(indexPrefix);
  }

  public LogSearchResult search(UUID tenantId, LogSearchQuery query) {
    OpenSearchTransport transport = transportProvider.getIfAvailable();
    if (transport == null) {
      return LogSearchResult.unavailable();
    }
    try {
      OpenSearchResponse response =
          transport.execute(
              "POST",
              "/" + indexNames.pattern() + "/_search",
              objectMapper.writeValueAsString(requestBody(tenantId, query)));
      if (!response.successful()) {
        return LogSearchResult.unavailable();
      }
      return parse(response.body());
    } catch (IOException ex) {
      return LogSearchResult.unavailable();
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      return LogSearchResult.unavailable();
    }
  }

  private Map<String, Object> requestBody(UUID tenantId, LogSearchQuery query) {
    List<Object> filters = new ArrayList<>();
    filters.add(Map.of("term", Map.of("tenantId", tenantId.toString())));
    if (query.correlationId() != null && !query.correlationId().isBlank()) {
      filters.add(Map.of("term", Map.of("correlationId", query.correlationId())));
    }
    Map<String, Object> range = new LinkedHashMap<>();
    range.put("gte", query.from().toString());
    range.put("lte", query.to().toString());
    filters.add(Map.of("range", Map.of("timestamp", range)));

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("size", query.limit());
    body.put("sort", List.of(Map.of("timestamp", Map.of("order", "desc"))));
    body.put("query", Map.of("bool", Map.of("filter", filters)));
    return body;
  }

  private LogSearchResult parse(String body) throws IOException {
    JsonNode root = objectMapper.readTree(body);
    JsonNode hits = root.path("hits");
    long total = hits.path("total").path("value").asLong(0);
    List<LogEvent> logs = new ArrayList<>();
    for (JsonNode hit : hits.path("hits")) {
      JsonNode source = hit.path("_source");
      if (source.isObject()) {
        logs.add(toEvent(source));
      }
    }
    return new LogSearchResult(true, total, logs);
  }

  private LogEvent toEvent(JsonNode source) {
    return new LogEvent(
        source.path("tenantId").asText(),
        source.path("service").asText(),
        source.path("level").asText(),
        source.path("logger").asText(),
        redactor.redact(source.path("message").asText("")),
        source.path("correlationId").asText(),
        source.path("traceId").asText(),
        parseTimestamp(source.path("timestamp").asText("")));
  }

  private static Instant parseTimestamp(String value) {
    try {
      return Instant.parse(value);
    } catch (DateTimeParseException ex) {
      return Instant.EPOCH;
    }
  }
}

package com.awap.observability.log.infrastructure;

import com.awap.analytics.infrastructure.opensearch.OpenSearchResponse;
import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import com.awap.observability.log.application.LogIndexNames;
import com.awap.observability.log.application.LogRedactor;
import com.awap.observability.log.application.LogShipper;
import com.awap.observability.log.domain.LogEvent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Bounded, fail-open operational log shipper (issue #286).
 *
 * <p>Application threads only append to a bounded queue, so an OpenSearch outage can never block a
 * request. A scheduled drain retries retryable failures and routes exhausted documents to a daily
 * dead-letter index. Queue overflow drops the oldest event and increments a metric.
 */
@Component
@ConditionalOnProperty(name = "awap.logs.opensearch.enabled", havingValue = "true")
public class OpenSearchLogShipper implements LogShipper, AutoCloseable {

  private static final Logger log = LoggerFactory.getLogger(OpenSearchLogShipper.class);

  private final ObjectProvider<OpenSearchTransport> transportProvider;
  private final ObjectMapper objectMapper;
  private final MeterRegistry meterRegistry;
  private final LogIndexNames indexNames;
  private final LogRedactor redactor = new LogRedactor();
  private final int queueCapacity;
  private final int batchSize;
  private final int maxAttempts;

  private final Object queueLock = new Object();
  private final Object flushLock = new Object();
  private final ArrayDeque<LogEvent> queue = new ArrayDeque<>();

  private volatile boolean closed;

  @Autowired
  public OpenSearchLogShipper(
      ObjectProvider<OpenSearchTransport> transportProvider,
      ObjectMapper objectMapper,
      MeterRegistry meterRegistry,
      @Value("${awap.logs.index:awap-logs}") String indexPrefix,
      @Value("${awap.logs.queue-capacity:1000}") int queueCapacity,
      @Value("${awap.logs.batch-size:100}") int batchSize,
      @Value("${awap.logs.max-attempts:3}") int maxAttempts) {
    this.transportProvider = transportProvider;
    this.objectMapper = objectMapper;
    this.meterRegistry = meterRegistry;
    this.indexNames = new LogIndexNames(indexPrefix);
    this.queueCapacity = Math.max(1, queueCapacity);
    this.batchSize = Math.max(1, batchSize);
    this.maxAttempts = Math.max(1, maxAttempts);
  }

  @Override
  public void ship(LogEvent event) {
    if (event == null || closed) {
      return;
    }
    synchronized (queueLock) {
      if (queue.size() >= queueCapacity) {
        queue.pollFirst();
        increment("dropped");
      }
      queue.addLast(event);
    }
  }

  @Override
  public int queueDepth() {
    synchronized (queueLock) {
      return queue.size();
    }
  }

  /** Drains one bounded batch; scheduled in production and called directly by tests. */
  @Scheduled(fixedDelayString = "${awap.logs.flush-interval-ms:1000}")
  public void flush() {
    if (closed) {
      return;
    }
    synchronized (flushLock) {
      List<LogEvent> batch = pollBatch();
      if (batch.isEmpty()) {
        return;
      }
      OpenSearchTransport transport = transportProvider.getIfAvailable();
      if (transport == null) {
        batch.forEach(ignored -> increment("dropped"));
        log.debug(
            "Dropped {} log events because the OpenSearch transport is unavailable", batch.size());
        return;
      }
      batch.forEach(event -> send(event, transport));
    }
  }

  @Override
  @PreDestroy
  public void close() {
    flush();
    closed = true;
  }

  private List<LogEvent> pollBatch() {
    synchronized (queueLock) {
      int size = Math.min(batchSize, queue.size());
      List<LogEvent> batch = new ArrayList<>(size);
      for (int index = 0; index < size; index++) {
        batch.add(queue.pollFirst());
      }
      return batch;
    }
  }

  private void send(LogEvent event, OpenSearchTransport transport) {
    String body;
    try {
      body = objectMapper.writeValueAsString(redactor.document(event));
    } catch (JsonProcessingException ex) {
      increment("dlq");
      return;
    }
    String reason = "exhausted retries";
    for (int attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        OpenSearchResponse response =
            transport.execute(
                "PUT",
                "/" + indexNames.dailyIndex(event.timestamp()) + "/_doc/" + UUID.randomUUID(),
                body);
        if (response.successful()) {
          increment("indexed");
          return;
        }
        reason = "http_" + response.status();
        if (!isRetryable(response.status())) {
          break;
        }
      } catch (IOException ex) {
        reason = "io_" + ex.getClass().getSimpleName();
      } catch (InterruptedException ex) {
        Thread.currentThread().interrupt();
        reason = "interrupted";
        break;
      }
    }
    deadLetter(event, reason, body);
  }

  private static boolean isRetryable(int status) {
    return status == 429 || status >= 500;
  }

  private void deadLetter(LogEvent event, String reason, String body) {
    increment("dlq");
    Map<String, Object> envelope = new LinkedHashMap<>();
    envelope.put("failedAt", java.time.Instant.now().toString());
    envelope.put("reason", reason);
    envelope.put("document", body);
    try {
      OpenSearchTransport transport = transportProvider.getIfAvailable();
      if (transport != null) {
        transport.execute(
            "PUT",
            "/" + indexNames.deadLetterIndex(event.timestamp()) + "/_doc/" + UUID.randomUUID(),
            objectMapper.writeValueAsString(envelope));
      }
    } catch (IOException ex) {
      log.debug("Could not write the log dead-letter document: {}", ex.getMessage());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
    }
  }

  private void increment(String outcome) {
    meterRegistry.counter("awap.logs.shipped", "outcome", outcome).increment();
  }
}

package com.awap.observability.log.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.analytics.infrastructure.opensearch.OpenSearchResponse;
import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import com.awap.observability.log.domain.LogEvent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

class OpenSearchLogShipperTest {

  private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
  private final ObjectMapper mapper = new ObjectMapper();

  @SuppressWarnings("unchecked")
  private static ObjectProvider<OpenSearchTransport> provider(OpenSearchTransport transport) {
    ObjectProvider<OpenSearchTransport> provider = mock(ObjectProvider.class);
    when(provider.getIfAvailable()).thenReturn(transport);
    return provider;
  }

  private OpenSearchLogShipper shipper(
      ObjectProvider<OpenSearchTransport> provider, int capacity, int batch, int attempts) {
    return new OpenSearchLogShipper(
        provider, mapper, meters, "awap-logs", capacity, batch, attempts);
  }

  private static LogEvent event(String message) {
    return new LogEvent(
        "tenant-1",
        "awap-backend",
        "INFO",
        "log",
        message,
        "corr",
        "trace",
        Instant.parse("2026-11-15T10:00:00Z"));
  }

  private double count(String outcome) {
    return meters.get("awap.logs.shipped").tag("outcome", outcome).counter().count();
  }

  @Test
  void drainsBatchesToDailyIndices() {
    RecordingLogTransport transport = new RecordingLogTransport();
    OpenSearchLogShipper shipper = shipper(provider(transport), 10, 2, 2);

    shipper.ship(event("one"));
    shipper.ship(event("two"));
    shipper.flush();

    assertThat(shipper.queueDepth()).isZero();
    assertThat(transport.requests()).hasSize(2);
    assertThat(transport.requests().getFirst().path()).startsWith("/awap-logs-2026.11.15/_doc/");
    assertThat(count("indexed")).isEqualTo(2);
  }

  @Test
  void dropsTheOldestEventWhenTheQueueIsFull() {
    RecordingLogTransport transport = new RecordingLogTransport();
    OpenSearchLogShipper shipper = shipper(provider(transport), 1, 10, 1);

    shipper.ship(event("one"));
    shipper.ship(event("two"));
    shipper.flush();

    assertThat(count("dropped")).isEqualTo(1);
    assertThat(count("indexed")).isEqualTo(1);
  }

  @Test
  void dropsBatchesWhenTheTransportIsUnavailable() {
    @SuppressWarnings("unchecked")
    ObjectProvider<OpenSearchTransport> empty = mock(ObjectProvider.class);
    when(empty.getIfAvailable()).thenReturn(null);
    OpenSearchLogShipper shipper = shipper(empty, 10, 10, 1);

    shipper.ship(event("one"));
    shipper.flush();

    assertThat(count("dropped")).isEqualTo(1);
  }

  @Test
  void routesExhaustedEventsToTheDeadLetterIndex() {
    RecordingLogTransport transport = new RecordingLogTransport();
    transport.respondWith(new OpenSearchResponse(400, "mapping conflict"));
    OpenSearchLogShipper shipper = shipper(provider(transport), 10, 10, 3);

    shipper.ship(event("bad"));
    shipper.flush();

    assertThat(transport.requests()).hasSize(2);
    assertThat(transport.requests().get(1).path()).startsWith("/awap-logs-dlq-2026.11.15/_doc/");
    assertThat(count("dlq")).isEqualTo(1);
  }

  @Test
  void retriesRetryableFailuresAndIoErrors() {
    RecordingLogTransport retry = new RecordingLogTransport();
    retry.respondWith(new OpenSearchResponse(503, "{}"));
    retry.respondWith(new OpenSearchResponse(200, "{}"));
    OpenSearchLogShipper retrying = shipper(provider(retry), 10, 10, 3);
    retrying.ship(event("retry"));
    retrying.flush();
    assertThat(count("indexed")).isEqualTo(1);

    RecordingLogTransport io = new RecordingLogTransport();
    io.failWith(new IOException("down"));
    io.respondWith(new OpenSearchResponse(200, "{}"));
    OpenSearchLogShipper ioShipper = shipper(provider(io), 10, 10, 3);
    ioShipper.ship(event("io"));
    ioShipper.flush();
    assertThat(count("indexed")).isEqualTo(2);
  }

  @Test
  void interruptedRetryIsDeadLetteredAndRestoresTheInterruptFlag() {
    RecordingLogTransport transport = new RecordingLogTransport();
    transport.failWith(new InterruptedException("stop"));
    OpenSearchLogShipper shipper = shipper(provider(transport), 10, 10, 3);

    shipper.ship(event("stop"));
    shipper.flush();

    assertThat(count("dlq")).isEqualTo(1);
    assertThat(Thread.interrupted()).isTrue();
  }

  @Test
  void skipsSerializationFailuresAndUnavailableDeadLetterTransport() throws Exception {
    ObjectMapper failing = mock(ObjectMapper.class);
    when(failing.writeValueAsString(any())).thenThrow(mock(JsonProcessingException.class));
    OpenSearchLogShipper shipper =
        new OpenSearchLogShipper(
            provider(new RecordingLogTransport()), failing, meters, "awap-logs", 10, 10, 1);

    shipper.ship(event("bad"));
    shipper.flush();

    assertThat(count("dlq")).isEqualTo(1);
  }

  @Test
  void closedShipperIgnoresNewEventsButFlushesOnClose() {
    RecordingLogTransport transport = new RecordingLogTransport();
    OpenSearchLogShipper shipper = shipper(provider(transport), 10, 10, 1);
    shipper.ship(event("one"));
    shipper.close();
    shipper.ship(event("two"));
    shipper.flush();

    assertThat(transport.requests()).hasSize(1);
    assertThat(shipper.queueDepth()).isZero();
  }

  @Test
  void nullEventsAreIgnored() {
    OpenSearchLogShipper shipper = shipper(provider(new RecordingLogTransport()), 10, 10, 1);

    shipper.ship(null);

    assertThat(shipper.queueDepth()).isZero();
  }
}

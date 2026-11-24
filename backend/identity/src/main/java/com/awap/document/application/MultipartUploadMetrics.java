package com.awap.document.application;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * Counters for the resumable upload protocol (issue #372). Part retries happen in the browser, so
 * the retry signal the server can observe is a repeated part acknowledgement; that is what {@link
 * #partRejected()} and {@link #initiated()} against {@link #completed()} expose.
 */
@Component
public class MultipartUploadMetrics {

  static final String PREFIX = "awap.document.multipart.";

  private final Counter initiated;
  private final Counter completed;
  private final Counter aborted;
  private final Counter staleAborted;
  private final Counter checksumRejected;
  private final Counter partRejected;

  public MultipartUploadMetrics(MeterRegistry meterRegistry) {
    this.initiated = Counter.builder(PREFIX + "initiated").register(meterRegistry);
    this.completed = Counter.builder(PREFIX + "completed").register(meterRegistry);
    this.aborted = Counter.builder(PREFIX + "aborted").register(meterRegistry);
    this.staleAborted = Counter.builder(PREFIX + "stale_aborted").register(meterRegistry);
    this.checksumRejected = Counter.builder(PREFIX + "checksum_rejected").register(meterRegistry);
    this.partRejected = Counter.builder(PREFIX + "part_rejected").register(meterRegistry);
  }

  public void initiated() {
    initiated.increment();
  }

  public void completed() {
    completed.increment();
  }

  public void aborted() {
    aborted.increment();
  }

  public void staleAborted() {
    staleAborted.increment();
  }

  public void checksumRejected() {
    checksumRejected.increment();
  }

  public void partRejected() {
    partRejected.increment();
  }
}

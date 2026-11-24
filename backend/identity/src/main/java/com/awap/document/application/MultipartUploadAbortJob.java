package com.awap.document.application;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Reaps abandoned resumable uploads (issue #372). Runs hourly by default; each expired row is
 * aborted exactly once because the service flips its status inside the transaction.
 */
@Component
public class MultipartUploadAbortJob {

  private static final Logger log = LoggerFactory.getLogger(MultipartUploadAbortJob.class);

  private final MultipartUploadService service;

  public MultipartUploadAbortJob(MultipartUploadService service) {
    this.service = service;
  }

  @Scheduled(
      initialDelayString = "${awap.files.multipart-abort-initial-delay-ms:60000}",
      fixedDelayString = "${awap.files.multipart-abort-interval-ms:3600000}")
  public void abortStaleUploads() {
    int aborted = service.abortStale(Instant.now());
    if (aborted > 0) {
      log.info("Aborted {} expired resumable upload(s).", aborted);
    }
  }
}

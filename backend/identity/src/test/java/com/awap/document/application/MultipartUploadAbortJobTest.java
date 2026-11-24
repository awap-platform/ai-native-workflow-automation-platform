package com.awap.document.application;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MultipartUploadAbortJobTest {

  @Mock private MultipartUploadService service;

  @Test
  void theJobAbortsStaleUploads() {
    when(service.abortStale(any(Instant.class))).thenReturn(2);

    new MultipartUploadAbortJob(service).abortStaleUploads();

    verify(service).abortStale(any(Instant.class));
  }

  @Test
  void theJobIsQuietWhenNothingIsStale() {
    when(service.abortStale(any(Instant.class))).thenReturn(0);

    new MultipartUploadAbortJob(service).abortStaleUploads();

    verify(service).abortStale(any(Instant.class));
  }
}

package com.awap.document.domain;

/** Lifecycle of one resumable upload (issue #372). */
public enum MultipartUploadStatus {
  /** Parts may still be uploaded; the row is the resume token. */
  IN_PROGRESS,
  /** Every part was assembled, checksum-verified and handed to the scan pipeline. */
  COMPLETED,
  /** Cancelled by the client or reaped by the TTL job; any staged part was deleted. */
  ABORTED
}

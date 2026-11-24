package com.awap.document.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The resume token and the deterministic part plan (issue #372). */
class MultipartUploadTest {

  private MultipartUpload upload(long size, long partSize, int partCount) {
    return new MultipartUpload(
        UUID.randomUUID(),
        UUID.randomUUID(),
        "report.pdf",
        "application/pdf",
        size,
        "a".repeat(64),
        partSize,
        partCount,
        "tenant/file/.parts",
        "tenant/file/report.pdf",
        Instant.now().plusSeconds(60));
  }

  @Test
  void thePlanCoversTheFileExactlyOnce() {
    MultipartUpload upload = upload(20, 8, 3);

    long total = 0;
    for (int part = 1; part <= upload.getPartCount(); part++) {
      total += upload.expectedPartSize(part);
    }

    assertThat(total).isEqualTo(upload.getSize());
    assertThat(upload.expectedPartSize(1)).isEqualTo(8);
    assertThat(upload.expectedPartSize(3)).isEqualTo(4);
    assertThat(upload.partObjectKey(2)).isEqualTo("tenant/file/.parts/part-2");
  }

  @Test
  void acknowledgedPartsAreSortedAndIdempotent() {
    MultipartUpload upload = upload(20, 8, 3);

    upload.acknowledgePart(3);
    upload.acknowledgePart(1);
    upload.acknowledgePart(1);

    assertThat(upload.acknowledgedParts()).containsExactly(1, 3);
    assertThat(upload.hasPart(1)).isTrue();
    assertThat(upload.hasPart(2)).isFalse();
  }

  @Test
  void statusTransitionsAreExplicit() {
    MultipartUpload upload = upload(20, 8, 3);
    assertThat(upload.getStatus()).isEqualTo(MultipartUploadStatus.IN_PROGRESS);

    upload.markCompleted();
    assertThat(upload.getStatus()).isEqualTo(MultipartUploadStatus.COMPLETED);

    MultipartUpload aborted = upload(20, 8, 3);
    aborted.markAborted();
    assertThat(aborted.getStatus()).isEqualTo(MultipartUploadStatus.ABORTED);
  }

  @Test
  void expiryIsEvaluatedAgainstTheClock() {
    MultipartUpload upload = upload(20, 8, 3);

    assertThat(upload.expiredAt(Instant.now())).isFalse();
    assertThat(upload.expiredAt(upload.getExpiresAt().plusSeconds(1))).isTrue();
  }

  @Test
  void theAccessorsExposeEveryPersistedField() {
    MultipartUpload upload = upload(20, 8, 3);

    assertThat(upload.getId()).isNotNull();
    assertThat(upload.getUploadId()).isNotNull();
    assertThat(upload.getName()).isEqualTo("report.pdf");
    assertThat(upload.getContentType()).isEqualTo("application/pdf");
    assertThat(upload.getExpectedSha256()).isEqualTo("a".repeat(64));
    assertThat(upload.getPartSize()).isEqualTo(8);
    assertThat(upload.getStagingPrefix()).isEqualTo("tenant/file/.parts");
    assertThat(upload.getObjectKey()).isEqualTo("tenant/file/report.pdf");
    assertThat(upload.getCreatedAt()).isNotNull();
    assertThat(upload.getUpdatedAt()).isNotNull();
    assertThat(upload.getTenantId()).isNotNull();
    assertThat(upload.getFileId()).isNotNull();
  }

  @Test
  void aFreshUploadHasNoAcknowledgedPart() {
    MultipartUpload upload = upload(20, 8, 3);
    assertThat(upload.acknowledgedParts()).isEmpty();
  }
}

package com.awap.document.interfaces.dto;

import com.awap.document.application.MultipartUploadService;
import com.awap.document.domain.MultipartUploadStatus;
import com.awap.file.domain.FileScanStatus;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Response and request payloads for the resumable upload protocol (issue #372). */
public final class MultipartUploadResponses {

  private MultipartUploadResponses() {}

  /** One presigned part slot. */
  public record PartUrl(UUID uploadId, int partNumber, String url, long expiresInSeconds) {

    public static PartUrl of(UUID uploadId, MultipartUploadService.PartUrl part) {
      return new PartUrl(uploadId, part.partNumber(), part.url(), part.expiresInSeconds());
    }
  }

  /** Result of {@code initiate}. */
  public record Initiated(
      UUID uploadId,
      UUID fileId,
      long partSize,
      int partCount,
      Instant expiresAt,
      List<PartUrl> parts) {

    public static Initiated of(MultipartUploadService.InitiatedUpload upload) {
      return new Initiated(
          upload.uploadId(),
          upload.fileId(),
          upload.partSize(),
          upload.partCount(),
          upload.expiresAt(),
          upload.parts().stream().map(part -> PartUrl.of(upload.uploadId(), part)).toList());
    }
  }

  /** Resume view: what to keep, what to re-send. */
  public record Status(
      UUID uploadId,
      MultipartUploadStatus status,
      long partSize,
      int partCount,
      List<Integer> acknowledgedParts,
      long size,
      Instant expiresAt) {

    public static Status of(MultipartUploadService.UploadStatus status) {
      return new Status(
          status.uploadId(),
          status.status(),
          status.partSize(),
          status.partCount(),
          status.acknowledgedParts(),
          status.size(),
          status.expiresAt());
    }
  }

  /** Request to finish an upload; the checksum must equal the one promised at initiate time. */
  public record Complete(@NotBlank String sha256) {}

  /** Result of a verified completion, including the pending document version. */
  public record Completed(
      UUID fileId,
      String name,
      FileScanStatus status,
      Instant expiresAt,
      boolean scanned,
      UUID versionId,
      int version) {

    public static Completed of(
        MultipartUploadService.CompletedUpload upload, UUID versionId, int version) {
      return new Completed(
          upload.fileId(),
          upload.name(),
          upload.status(),
          upload.expiresAt(),
          upload.status() == FileScanStatus.PROMOTED,
          versionId,
          version);
    }
  }
}

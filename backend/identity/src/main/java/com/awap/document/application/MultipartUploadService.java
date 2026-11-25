package com.awap.document.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.document.domain.MultipartUpload;
import com.awap.document.domain.MultipartUploadStatus;
import com.awap.document.infrastructure.MultipartUploadRepository;
import com.awap.file.application.FileObjectStore;
import com.awap.file.application.FileService;
import com.awap.file.application.FileStorageProperties;
import com.awap.file.domain.FileStorageException;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resumable upload protocol (issue #372).
 *
 * <p>Flow: {@code initiate} fixes the part plan and the checksum, the client PUTs each part to a
 * short-lived presigned URL scoped to one staging object, {@code acknowledgePart} records that the
 * server observed the exact planned byte count, and {@code complete} composes the parts, verifies
 * the SHA-256 of the assembled object and only then hands the file to the quarantine scan pipeline.
 *
 * <p>The server never trusts a client-declared size or path: the staging keys are generated here,
 * the expected part size comes from the plan, and completion fails when the assembled object does
 * not hash to the value promised at initiate time. Uploads expire after {@link #UPLOAD_TTL} so
 * abandoned parts are always reclaimed.
 */
@Service
public class MultipartUploadService {

  static final long MIN_PART_SIZE = 5L * 1024 * 1024;
  static final long DEFAULT_PART_SIZE = 8L * 1024 * 1024;
  static final int MAX_PARTS = 10_000;
  static final Duration UPLOAD_TTL = Duration.ofHours(24);

  private static final Logger log = LoggerFactory.getLogger(MultipartUploadService.class);

  private final MultipartUploadRepository repository;
  private final FileService fileService;
  private final FileObjectStore objectStore;
  private final FileStorageProperties properties;
  private final MultipartUploadMetrics metrics;

  public MultipartUploadService(
      MultipartUploadRepository repository,
      FileService fileService,
      FileObjectStore objectStore,
      FileStorageProperties properties,
      MultipartUploadMetrics metrics) {
    this.repository = repository;
    this.fileService = fileService;
    this.objectStore = objectStore;
    this.properties = properties;
    this.metrics = metrics;
  }

  /** Creates the resume token and returns the plan plus one short-lived URL per part. */
  @Transactional
  public InitiatedUpload initiate(
      UUID tenantId, String name, String contentType, long size, String sha256) {
    validateName(name);
    validateSize(size);
    validateFormat(name);
    validateChecksum(sha256);

    long partSize = Math.max(MIN_PART_SIZE, DEFAULT_PART_SIZE);
    long partCount = (size + partSize - 1) / partSize;
    if (partCount > MAX_PARTS) {
      throw new AwapException(
          ErrorCode.FILE_TOO_LARGE,
          HttpStatus.PAYLOAD_TOO_LARGE,
          "This file needs more than " + MAX_PARTS + " parts; use a larger part size.");
    }

    UUID fileId = UUID.randomUUID();
    String objectKey = FileService.objectKey(tenantId, fileId, name);
    String stagingPrefix = tenantId + "/" + fileId + "/.parts";
    MultipartUpload upload =
        new MultipartUpload(
            tenantId,
            fileId,
            name,
            contentType,
            size,
            sha256.toLowerCase(Locale.ROOT),
            partSize,
            (int) partCount,
            stagingPrefix,
            objectKey,
            Instant.now().plus(UPLOAD_TTL));
    repository.save(upload);
    metrics.initiated();
    return new InitiatedUpload(
        upload.getUploadId(),
        fileId,
        partSize,
        (int) partCount,
        upload.getExpiresAt(),
        partUrls(upload, 1, (int) partCount));
  }

  /** Fresh presigned URL for one part; the TTL is the configured presign window. */
  @Transactional(readOnly = true)
  public PartUrl presignPart(UUID tenantId, UUID uploadId, int partNumber) {
    MultipartUpload upload = requireInProgress(tenantId, uploadId);
    requirePartNumber(upload, partNumber);
    String url =
        objectStore.presignedPut(
            properties.quarantineBucket(),
            upload.partObjectKey(partNumber),
            properties.presignTtl());
    return new PartUrl(partNumber, url, properties.presignTtl().toSeconds());
  }

  /**
   * Records a part the server actually observed. The stored size must equal the planned size, so a
   * truncated or padded part is rejected instead of silently breaking the checksum later.
   */
  @Transactional
  public UploadStatus acknowledgePart(UUID tenantId, UUID uploadId, int partNumber) {
    MultipartUpload upload = requireInProgress(tenantId, uploadId);
    requirePartNumber(upload, partNumber);
    long expected = upload.expectedPartSize(partNumber);
    long actual;
    try {
      actual =
          objectStore.statSize(properties.quarantineBucket(), upload.partObjectKey(partNumber));
    } catch (FileStorageException ex) {
      metrics.partRejected();
      throw new AwapException(
          ErrorCode.FILE_UPLOAD_INCOMPLETE,
          HttpStatus.CONFLICT,
          "Part " + partNumber + " has not been uploaded yet.");
    }
    if (actual != expected) {
      metrics.partRejected();
      throw new AwapException(
          ErrorCode.FILE_CHECKSUM_MISMATCH,
          HttpStatus.UNPROCESSABLE_ENTITY,
          "Part "
              + partNumber
              + " has "
              + actual
              + " bytes but the plan expects "
              + expected
              + ".");
    }
    upload.acknowledgePart(partNumber);
    repository.save(upload);
    return statusOf(upload);
  }

  /**
   * Assembles the parts, verifies the checksum and registers the file for scanning. A mismatch
   * deletes the assembled object and answers 422 so a corrupted upload can never reach the scanner.
   */
  @Transactional
  public CompletedUpload complete(UUID tenantId, UUID uploadId, String sha256) {
    MultipartUpload upload = requireInProgress(tenantId, uploadId);
    validateChecksum(sha256);
    if (!upload.getExpectedSha256().equalsIgnoreCase(sha256)) {
      throw mismatch();
    }
    if (upload.acknowledgedParts().size() != upload.getPartCount()) {
      throw new AwapException(
          ErrorCode.FILE_UPLOAD_INCOMPLETE,
          HttpStatus.CONFLICT,
          "The upload is missing "
              + (upload.getPartCount() - upload.acknowledgedParts().size())
              + " part(s).");
    }

    List<String> partKeys = new ArrayList<>();
    for (int part = 1; part <= upload.getPartCount(); part++) {
      partKeys.add(upload.partObjectKey(part));
    }
    String bucket = properties.quarantineBucket();
    objectStore.compose(bucket, upload.getObjectKey(), partKeys);

    long assembledSize = objectStore.statSize(bucket, upload.getObjectKey());
    if (assembledSize != upload.getSize()) {
      discard(bucket, upload, partKeys);
      throw mismatch();
    }
    String actual = sha256Of(bucket, upload.getObjectKey());
    if (!actual.equalsIgnoreCase(upload.getExpectedSha256())) {
      discard(bucket, upload, partKeys);
      throw mismatch();
    }
    for (String partKey : partKeys) {
      objectStore.delete(bucket, partKey);
    }

    FileService.FileScanInfo info =
        fileService.acceptStagedUpload(
            tenantId,
            upload.getFileId(),
            upload.getName(),
            upload.getContentType(),
            upload.getSize(),
            upload.getObjectKey());
    upload.markCompleted();
    repository.save(upload);
    metrics.completed();
    return new CompletedUpload(
        upload.getFileId(), info.name(), info.status(), upload.getExpiresAt());
  }

  /** Cancels an upload; the staged parts are deleted and a repeated abort is a no-op. */
  @Transactional
  public void abort(UUID tenantId, UUID uploadId) {
    MultipartUpload upload = require(tenantId, uploadId);
    if (upload.getStatus() == MultipartUploadStatus.COMPLETED) {
      throw new AwapException(
          ErrorCode.FILE_STATE_CONFLICT,
          HttpStatus.CONFLICT,
          "A completed upload cannot be aborted.");
    }
    if (upload.getStatus() == MultipartUploadStatus.ABORTED) {
      return;
    }
    purgeParts(upload);
    upload.markAborted();
    repository.save(upload);
    metrics.aborted();
  }

  /** Resume view: the plan, the acknowledged parts and the remaining time. */
  @Transactional(readOnly = true)
  public UploadStatus status(UUID tenantId, UUID uploadId) {
    return statusOf(require(tenantId, uploadId));
  }

  /**
   * Reaps abandoned uploads. The status guard makes the abort happen exactly once even when two
   * scheduler ticks overlap, and a storage failure is logged instead of failing the whole sweep.
   */
  @Transactional
  public int abortStale(Instant now) {
    List<MultipartUpload> stale =
        repository.findByStatusInAndExpiresAtBefore(
            List.of(MultipartUploadStatus.IN_PROGRESS), now);
    int aborted = 0;
    for (MultipartUpload upload : stale) {
      purgeParts(upload);
      upload.markAborted();
      repository.save(upload);
      metrics.staleAborted();
      aborted++;
    }
    return aborted;
  }

  private void discard(String bucket, MultipartUpload upload, List<String> partKeys) {
    try {
      objectStore.delete(bucket, upload.getObjectKey());
    } catch (FileStorageException ex) {
      log.warn(
          "Could not delete the rejected object {}: {}", upload.getObjectKey(), ex.getMessage());
    }
    for (String partKey : partKeys) {
      try {
        objectStore.delete(bucket, partKey);
      } catch (FileStorageException ex) {
        log.warn("Could not delete the staged part {}: {}", partKey, ex.getMessage());
      }
    }
    metrics.checksumRejected();
  }

  private void purgeParts(MultipartUpload upload) {
    String bucket = properties.quarantineBucket();
    for (int part = 1; part <= upload.getPartCount(); part++) {
      try {
        objectStore.delete(bucket, upload.partObjectKey(part));
      } catch (FileStorageException ex) {
        log.debug("Staged part {} was already gone: {}", part, ex.getMessage());
      }
    }
  }

  private List<PartUrl> partUrls(MultipartUpload upload, int from, int to) {
    List<PartUrl> urls = new ArrayList<>();
    for (int part = from; part <= to; part++) {
      urls.add(
          new PartUrl(
              part,
              objectStore.presignedPut(
                  properties.quarantineBucket(),
                  upload.partObjectKey(part),
                  properties.presignTtl()),
              properties.presignTtl().toSeconds()));
    }
    return List.copyOf(urls);
  }

  private UploadStatus statusOf(MultipartUpload upload) {
    return new UploadStatus(
        upload.getUploadId(),
        upload.getStatus(),
        upload.getPartSize(),
        upload.getPartCount(),
        upload.acknowledgedParts(),
        upload.getSize(),
        upload.getExpiresAt());
  }

  private MultipartUpload require(UUID tenantId, UUID uploadId) {
    return repository
        .findByUploadIdAndTenantId(uploadId, tenantId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.FILE_NOT_FOUND, HttpStatus.NOT_FOUND, "Upload not found."));
  }

  private MultipartUpload requireInProgress(UUID tenantId, UUID uploadId) {
    MultipartUpload upload = require(tenantId, uploadId);
    if (upload.getStatus() != MultipartUploadStatus.IN_PROGRESS) {
      throw new AwapException(
          ErrorCode.FILE_STATE_CONFLICT,
          HttpStatus.CONFLICT,
          "The upload is already " + upload.getStatus().name().toLowerCase(Locale.ROOT) + ".");
    }
    if (upload.expiredAt(Instant.now())) {
      throw new AwapException(
          ErrorCode.FILE_STATE_CONFLICT,
          HttpStatus.CONFLICT,
          "The upload expired; start a new one.");
    }
    return upload;
  }

  private void requirePartNumber(MultipartUpload upload, int partNumber) {
    if (partNumber < 1 || partNumber > upload.getPartCount()) {
      metrics.partRejected();
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED,
          HttpStatus.BAD_REQUEST,
          "Part numbers run from 1 to " + upload.getPartCount() + ".");
    }
  }

  private String sha256Of(String bucket, String objectKey) {
    try (InputStream input = objectStore.open(bucket, objectKey)) {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) != -1) {
        digest.update(buffer, 0, read);
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (IOException | NoSuchAlgorithmException | FileStorageException ex) {
      throw new AwapException(
          ErrorCode.GENERIC_INTERNAL_ERROR,
          HttpStatus.INTERNAL_SERVER_ERROR,
          "The upload could not be verified.");
    }
  }

  private AwapException mismatch() {
    metrics.checksumRejected();
    return new AwapException(
        ErrorCode.FILE_CHECKSUM_MISMATCH,
        HttpStatus.UNPROCESSABLE_ENTITY,
        "The uploaded bytes do not match the declared SHA-256 checksum.");
  }

  private void validateName(String name) {
    if (name == null || name.isBlank()) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "File name is required.");
    }
  }

  private void validateSize(long size) {
    if (size <= 0) {
      throw new AwapException(
          ErrorCode.FILE_EMPTY, HttpStatus.BAD_REQUEST, "File must not be empty.");
    }
    if (size > properties.maxSizeBytes()) {
      throw new AwapException(
          ErrorCode.FILE_TOO_LARGE, HttpStatus.PAYLOAD_TOO_LARGE, "File exceeds the 500 MB limit.");
    }
  }

  private void validateFormat(String name) {
    int dot = name.lastIndexOf('.');
    String extension =
        dot >= 0 && dot < name.length() - 1 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
    if (!properties.allowedExtensions().contains(extension)) {
      throw new AwapException(
          ErrorCode.FILE_FORMAT_UNSUPPORTED,
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          "File format is not supported.");
    }
  }

  private void validateChecksum(String sha256) {
    if (sha256 == null || !sha256.matches("[0-9a-fA-F]{64}")) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED,
          HttpStatus.BAD_REQUEST,
          "A 64-character hex SHA-256 checksum is required.");
    }
  }

  /** One presigned part slot. */
  public record PartUrl(int partNumber, String url, long expiresInSeconds) {}

  /** Result of {@code initiate}: the plan plus ready-to-use part URLs. */
  public record InitiatedUpload(
      UUID uploadId,
      UUID fileId,
      long partSize,
      int partCount,
      Instant expiresAt,
      List<PartUrl> parts) {}

  /** Resume view of an upload. */
  public record UploadStatus(
      UUID uploadId,
      MultipartUploadStatus status,
      long partSize,
      int partCount,
      List<Integer> acknowledgedParts,
      long size,
      Instant expiresAt) {}

  /** Result of a verified completion. */
  public record CompletedUpload(
      UUID fileId, String name, com.awap.file.domain.FileScanStatus status, Instant expiresAt) {}
}

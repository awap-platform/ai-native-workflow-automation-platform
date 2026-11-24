package com.awap.document.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * A resumable upload (issue #372). The row is the resume token: it fixes the part plan and the
 * checksum the client promised, remembers which parts the server actually observed, and expires so
 * an abandoned upload cannot keep staged parts forever.
 *
 * <p>The plan is deterministic: part {@code n} covers {@code [(n-1)*partSize, min(n*partSize,
 * size))}, so a resumed client and the server agree on the expected byte count without trusting a
 * client-declared number.
 */
@Entity
@Table(name = "multipart_uploads")
public class MultipartUpload {

  @Id
  @Column(nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private UUID tenantId;

  @Column(name = "upload_id", nullable = false)
  private UUID uploadId;

  @Column(name = "file_id", nullable = false)
  private UUID fileId;

  @Column(nullable = false)
  private String name;

  @Column(name = "content_type")
  private String contentType;

  @Column(nullable = false)
  private long size;

  @Column(name = "expected_sha256", nullable = false)
  private String expectedSha256;

  @Column(name = "part_size", nullable = false)
  private long partSize;

  @Column(name = "part_count", nullable = false)
  private int partCount;

  @Column(name = "staging_prefix", nullable = false)
  private String stagingPrefix;

  @Column(name = "object_key", nullable = false)
  private String objectKey;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private MultipartUploadStatus status;

  @Column(name = "uploaded_parts", nullable = false)
  private String uploadedParts;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  protected MultipartUpload() {}

  public MultipartUpload(
      UUID tenantId,
      UUID fileId,
      String name,
      String contentType,
      long size,
      String expectedSha256,
      long partSize,
      int partCount,
      String stagingPrefix,
      String objectKey,
      Instant expiresAt) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.uploadId = UUID.randomUUID();
    this.fileId = fileId;
    this.name = name;
    this.contentType = contentType;
    this.size = size;
    this.expectedSha256 = expectedSha256;
    this.partSize = partSize;
    this.partCount = partCount;
    this.stagingPrefix = stagingPrefix;
    this.objectKey = objectKey;
    this.status = MultipartUploadStatus.IN_PROGRESS;
    this.uploadedParts = "";
    this.createdAt = Instant.now();
    this.updatedAt = this.createdAt;
    this.expiresAt = expiresAt;
  }

  public UUID getId() {
    return id;
  }

  public UUID getTenantId() {
    return tenantId;
  }

  public UUID getUploadId() {
    return uploadId;
  }

  public UUID getFileId() {
    return fileId;
  }

  public String getName() {
    return name;
  }

  public String getContentType() {
    return contentType;
  }

  public long getSize() {
    return size;
  }

  public String getExpectedSha256() {
    return expectedSha256;
  }

  public long getPartSize() {
    return partSize;
  }

  public int getPartCount() {
    return partCount;
  }

  public String getStagingPrefix() {
    return stagingPrefix;
  }

  public String getObjectKey() {
    return objectKey;
  }

  public MultipartUploadStatus getStatus() {
    return status;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }

  public Instant getExpiresAt() {
    return expiresAt;
  }

  /** Object key of one staged part; generated server-side so a client cannot choose the path. */
  public String partObjectKey(int partNumber) {
    return stagingPrefix + "/part-" + partNumber;
  }

  /** Exact byte count of one part, derived from the plan rather than from the client. */
  public long expectedPartSize(int partNumber) {
    long start = (long) (partNumber - 1) * partSize;
    return Math.min(partSize, size - start);
  }

  public boolean hasPart(int partNumber) {
    return acknowledgedParts().contains(partNumber);
  }

  public List<Integer> acknowledgedParts() {
    if (uploadedParts == null || uploadedParts.isBlank()) {
      return List.of();
    }
    return Arrays.stream(uploadedParts.split(","))
        .map(String::trim)
        .filter(entry -> !entry.isEmpty())
        .map(Integer::valueOf)
        .toList();
  }

  /** Records a part the server observed; repeated acknowledgements are idempotent. */
  public void acknowledgePart(int partNumber) {
    List<Integer> parts = new ArrayList<>(acknowledgedParts());
    if (parts.contains(partNumber)) {
      return;
    }
    parts.add(partNumber);
    parts.sort(Comparator.naturalOrder());
    this.uploadedParts = parts.stream().map(String::valueOf).collect(Collectors.joining(","));
    this.updatedAt = Instant.now();
  }

  public void markCompleted() {
    this.status = MultipartUploadStatus.COMPLETED;
    this.updatedAt = Instant.now();
  }

  public void markAborted() {
    this.status = MultipartUploadStatus.ABORTED;
    this.updatedAt = Instant.now();
  }

  public boolean expiredAt(Instant now) {
    return !expiresAt.isAfter(now);
  }
}

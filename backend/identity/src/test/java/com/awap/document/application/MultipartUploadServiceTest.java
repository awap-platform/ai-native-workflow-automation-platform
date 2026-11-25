package com.awap.document.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.document.domain.MultipartUpload;
import com.awap.document.domain.MultipartUploadStatus;
import com.awap.document.infrastructure.MultipartUploadRepository;
import com.awap.file.application.FileObjectStore;
import com.awap.file.application.FileService;
import com.awap.file.application.FileStorageProperties;
import com.awap.file.domain.FileScanStatus;
import com.awap.file.domain.FileStorageException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MultipartUploadServiceTest {

  private static final UUID TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final long MiB = 1024L * 1024L;

  @Mock private MultipartUploadRepository repository;
  @Mock private FileService fileService;
  @Mock private FileObjectStore objectStore;

  private final Map<UUID, MultipartUpload> rows = new HashMap<>();
  private FileStorageProperties properties;
  private MultipartUploadService service;

  private static FileStorageProperties props(long maxSizeBytes) {
    return new FileStorageProperties(
        "awap-quarantine",
        "awap-files",
        maxSizeBytes,
        300,
        "pdf,docx,xlsx,pptx,png,jpg,jpeg,txt",
        5,
        "DELETE",
        7,
        365,
        1,
        false);
  }

  private static String sha256(byte[] bytes) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }

  @BeforeEach
  void setUp() {
    properties = props(500 * MiB);
    service =
        new MultipartUploadService(
            repository,
            fileService,
            objectStore,
            properties,
            new MultipartUploadMetrics(new SimpleMeterRegistry()));
    lenient()
        .when(repository.save(any(MultipartUpload.class)))
        .thenAnswer(
            invocation -> {
              MultipartUpload upload = invocation.getArgument(0);
              rows.put(upload.getUploadId(), upload);
              return upload;
            });
    lenient()
        .when(repository.findByUploadIdAndTenantId(any(), any()))
        .thenAnswer(
            invocation -> Optional.ofNullable(rows.get(invocation.getArgument(0, UUID.class))));
    lenient()
        .when(objectStore.presignedPut(anyString(), anyString(), any(Duration.class)))
        .thenReturn("https://minio/part");
  }

  @Test
  void initiatePlansExactPartsAndPresignsEachOne() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 20 * MiB, "a".repeat(64));

    assertThat(upload.partSize()).isEqualTo(8 * MiB);
    assertThat(upload.partCount()).isEqualTo(3);
    assertThat(upload.parts()).hasSize(3);
    assertThat(upload.parts().get(2).partNumber()).isEqualTo(3);
    assertThat(upload.expiresAt()).isAfter(Instant.now());

    MultipartUpload row = rows.get(upload.uploadId());
    assertThat(row.getExpectedSha256()).isEqualTo("a".repeat(64));
    assertThat(row.expectedPartSize(3)).isEqualTo(4 * MiB);
    assertThat(row.partObjectKey(2)).endsWith("/.parts/part-2");
    assertThat(row.getObjectKey()).contains(TENANT.toString()).endsWith("/report.pdf");
  }

  @Test
  void initiateRejectsEmptyOversizedBadChecksumAndBadFormat() {
    assertThatThrownBy(
            () -> service.initiate(TENANT, "report.pdf", "application/pdf", 0, "a".repeat(64)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("must not be empty");
    assertThatThrownBy(
            () ->
                service.initiate(
                    TENANT, "report.pdf", "application/pdf", 501 * MiB, "a".repeat(64)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("500 MB");
    assertThatThrownBy(() -> service.initiate(TENANT, "report.pdf", "application/pdf", 10, "nope"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("SHA-256");
    assertThatThrownBy(() -> service.initiate(TENANT, "malware.exe", "x", 10, "a".repeat(64)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("format");
    assertThatThrownBy(() -> service.initiate(TENANT, "  ", "application/pdf", 10, "a".repeat(64)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("name");
  }

  @Test
  void initiateRejectsAFilesizeThatNeedsTooManyParts() {
    MultipartUploadService huge =
        new MultipartUploadService(
            repository,
            fileService,
            objectStore,
            props(200L * 1024 * MiB),
            new MultipartUploadMetrics(new SimpleMeterRegistry()));

    assertThatThrownBy(
            () ->
                huge.initiate(
                    TENANT, "report.pdf", "application/pdf", 200L * 1024 * MiB, "a".repeat(64)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("parts");
  }

  @Test
  void acknowledgePartVerifiesThePlannedSize() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 10, "a".repeat(64));
    when(objectStore.statSize("awap-quarantine", rows.get(upload.uploadId()).partObjectKey(1)))
        .thenReturn(10L);

    MultipartUploadService.UploadStatus status =
        service.acknowledgePart(TENANT, upload.uploadId(), 1);

    assertThat(status.acknowledgedParts()).containsExactly(1);
    assertThat(status.status()).isEqualTo(MultipartUploadStatus.IN_PROGRESS);
  }

  @Test
  void acknowledgePartRejectsAMissingOrShortPart() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 10, "a".repeat(64));
    when(objectStore.statSize(anyString(), anyString()))
        .thenThrow(new FileStorageException("missing"));

    assertThatThrownBy(() -> service.acknowledgePart(TENANT, upload.uploadId(), 1))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("has not been uploaded");

    org.mockito.Mockito.doReturn(4L).when(objectStore).statSize(anyString(), anyString());
    assertThatThrownBy(() -> service.acknowledgePart(TENANT, upload.uploadId(), 1))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("bytes but the plan expects 10");
  }

  @Test
  void acknowledgePartRejectsAnOutOfRangePartNumber() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 10, "a".repeat(64));

    assertThatThrownBy(() -> service.acknowledgePart(TENANT, upload.uploadId(), 2))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Part numbers run from 1 to 1");
  }

  @Test
  void completeComposesVerifiesAndRegistersTheFile() throws Exception {
    byte[] content = "hello world".getBytes(StandardCharsets.UTF_8);
    String checksum = sha256(content);
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.txt", "text/plain", content.length, checksum);
    MultipartUpload row = rows.get(upload.uploadId());
    row.acknowledgePart(1);
    when(objectStore.statSize("awap-quarantine", row.getObjectKey()))
        .thenReturn((long) content.length);
    when(objectStore.open("awap-quarantine", row.getObjectKey()))
        .thenReturn(new ByteArrayInputStream(content));
    when(fileService.acceptStagedUpload(
            eq(TENANT),
            eq(row.getFileId()),
            eq("report.txt"),
            eq("text/plain"),
            eq((long) content.length),
            eq(row.getObjectKey())))
        .thenReturn(
            new FileService.FileScanInfo(
                row.getFileId(), "report.txt", FileScanStatus.QUARANTINED, null));

    MultipartUploadService.CompletedUpload completed =
        service.complete(TENANT, upload.uploadId(), checksum);

    assertThat(completed.fileId()).isEqualTo(row.getFileId());
    assertThat(completed.status()).isEqualTo(FileScanStatus.QUARANTINED);
    assertThat(rows.get(upload.uploadId()).getStatus()).isEqualTo(MultipartUploadStatus.COMPLETED);
    verify(objectStore).compose(eq("awap-quarantine"), eq(row.getObjectKey()), any());
    verify(objectStore).delete("awap-quarantine", row.partObjectKey(1));
  }

  @Test
  void completeRejectsAChecksumMismatchAndDeletesTheUploadedBytes() throws Exception {
    byte[] content = "hello world".getBytes(StandardCharsets.UTF_8);
    String checksum = sha256(content);
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.txt", "text/plain", content.length, checksum);
    MultipartUpload row = rows.get(upload.uploadId());
    row.acknowledgePart(1);
    when(objectStore.statSize("awap-quarantine", row.getObjectKey()))
        .thenReturn((long) content.length);
    when(objectStore.open("awap-quarantine", row.getObjectKey()))
        .thenReturn(new ByteArrayInputStream("tampered".getBytes(StandardCharsets.UTF_8)));

    assertThatThrownBy(() -> service.complete(TENANT, upload.uploadId(), checksum))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("SHA-256");
    verify(objectStore).delete("awap-quarantine", row.getObjectKey());
    assertThat(rows.get(upload.uploadId()).getStatus())
        .isEqualTo(MultipartUploadStatus.IN_PROGRESS);
  }

  @Test
  void completeRejectsASizeMismatchAtAssembly() throws Exception {
    byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
    String checksum = sha256(content);
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.txt", "text/plain", content.length, checksum);
    MultipartUpload row = rows.get(upload.uploadId());
    row.acknowledgePart(1);
    when(objectStore.statSize("awap-quarantine", row.getObjectKey())).thenReturn(1L);

    assertThatThrownBy(() -> service.complete(TENANT, upload.uploadId(), checksum))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("SHA-256");
  }

  @Test
  void completeRejectsMissingPartsAndAForeignChecksum() throws Exception {
    byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.txt", "text/plain", content.length, sha256(content));

    assertThatThrownBy(() -> service.complete(TENANT, upload.uploadId(), sha256(content)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("missing 1 part");
    assertThatThrownBy(() -> service.complete(TENANT, upload.uploadId(), "b".repeat(64)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("SHA-256");
    assertThatThrownBy(() -> service.complete(TENANT, upload.uploadId(), null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("SHA-256");
  }

  @Test
  void abortPurgesStagedPartsAndIsIdempotent() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 20 * MiB, "a".repeat(64));
    MultipartUpload row = rows.get(upload.uploadId());

    service.abort(TENANT, upload.uploadId());
    service.abort(TENANT, upload.uploadId());

    assertThat(row.getStatus()).isEqualTo(MultipartUploadStatus.ABORTED);
    verify(objectStore).delete("awap-quarantine", row.partObjectKey(1));
    verify(objectStore).delete("awap-quarantine", row.partObjectKey(3));
  }

  @Test
  void abortRejectsACompletedUploadAndUnknownIds() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 20 * MiB, "a".repeat(64));
    rows.get(upload.uploadId()).markCompleted();

    assertThatThrownBy(() -> service.abort(TENANT, upload.uploadId()))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("cannot be aborted");
    assertThatThrownBy(() -> service.abort(TENANT, UUID.randomUUID()))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Upload not found");
  }

  @Test
  void abortStaleReapsOnlyExpiredUploads() {
    MultipartUploadService.InitiatedUpload expired =
        service.initiate(TENANT, "old.pdf", "application/pdf", 10, "a".repeat(64));
    rows.get(expired.uploadId()).markAborted();
    MultipartUploadService.InitiatedUpload live =
        service.initiate(TENANT, "new.pdf", "application/pdf", 10, "a".repeat(64));
    when(repository.findByStatusInAndExpiresAtBefore(any(), any()))
        .thenReturn(java.util.List.of(rows.get(expired.uploadId())));

    assertThat(service.abortStale(Instant.now())).isEqualTo(1);
    assertThat(rows.get(live.uploadId()).getStatus()).isEqualTo(MultipartUploadStatus.IN_PROGRESS);
  }

  @Test
  void abortStaleSurvivesAStorageFailure() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "old.pdf", "application/pdf", 10, "a".repeat(64));
    when(repository.findByStatusInAndExpiresAtBefore(any(), any()))
        .thenReturn(java.util.List.of(rows.get(upload.uploadId())));
    org.mockito.Mockito.doThrow(new FileStorageException("boom"))
        .when(objectStore)
        .delete(anyString(), anyString());

    assertThat(service.abortStale(Instant.now())).isEqualTo(1);
    assertThat(rows.get(upload.uploadId()).getStatus()).isEqualTo(MultipartUploadStatus.ABORTED);
  }

  @Test
  void presignPartRefreshesAUrlAndRejectsBadState() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 10, "a".repeat(64));

    MultipartUploadService.PartUrl url = service.presignPart(TENANT, upload.uploadId(), 1);
    assertThat(url.partNumber()).isEqualTo(1);
    assertThat(url.expiresInSeconds()).isEqualTo(300);
    assertThat(url.url()).startsWith("https://minio/");

    assertThatThrownBy(() -> service.presignPart(TENANT, upload.uploadId(), 5))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Part numbers run from 1 to 1");

    rows.get(upload.uploadId()).markCompleted();
    assertThatThrownBy(() -> service.presignPart(TENANT, upload.uploadId(), 1))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("already completed");
  }

  @Test
  void anExpiredUploadCannotBeUsed() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 10, "a".repeat(64));
    MultipartUpload row = rows.get(upload.uploadId());
    MultipartUpload expiredRow =
        new MultipartUpload(
            TENANT,
            row.getFileId(),
            "report.pdf",
            "application/pdf",
            10,
            "a".repeat(64),
            row.getPartSize(),
            1,
            row.getStagingPrefix(),
            row.getObjectKey(),
            Instant.now().minusSeconds(60));
    rows.put(expiredRow.getUploadId(), expiredRow);

    assertThatThrownBy(() -> service.presignPart(TENANT, expiredRow.getUploadId(), 1))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("expired");
  }

  @Test
  void statusExposesThePlanForAResume() {
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.pdf", "application/pdf", 10, "a".repeat(64));

    MultipartUploadService.UploadStatus status = service.status(TENANT, upload.uploadId());

    assertThat(status.partCount()).isEqualTo(1);
    assertThat(status.size()).isEqualTo(10);
    assertThat(status.acknowledgedParts()).isEmpty();
  }

  @Test
  void aChecksumMismatchStillCleansUpWhenStorageDeletesFail() throws Exception {
    byte[] content = "hello world".getBytes(StandardCharsets.UTF_8);
    String checksum = sha256(content);
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.txt", "text/plain", content.length, checksum);
    MultipartUpload row = rows.get(upload.uploadId());
    row.acknowledgePart(1);
    when(objectStore.statSize("awap-quarantine", row.getObjectKey()))
        .thenReturn((long) content.length);
    when(objectStore.open("awap-quarantine", row.getObjectKey()))
        .thenReturn(new ByteArrayInputStream("tampered".getBytes(StandardCharsets.UTF_8)));
    org.mockito.Mockito.doThrow(new FileStorageException("locked"))
        .when(objectStore)
        .delete(anyString(), anyString());

    assertThatThrownBy(() -> service.complete(TENANT, upload.uploadId(), checksum))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("SHA-256");
  }

  @Test
  void anUnreadableAssembledObjectFailsClosedWithA500() throws Exception {
    byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
    String checksum = sha256(content);
    MultipartUploadService.InitiatedUpload upload =
        service.initiate(TENANT, "report.txt", "text/plain", content.length, checksum);
    MultipartUpload row = rows.get(upload.uploadId());
    row.acknowledgePart(1);
    when(objectStore.statSize("awap-quarantine", row.getObjectKey()))
        .thenReturn((long) content.length);
    when(objectStore.open("awap-quarantine", row.getObjectKey()))
        .thenThrow(new FileStorageException("unreadable"));

    assertThatThrownBy(() -> service.complete(TENANT, upload.uploadId(), checksum))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("could not be verified");
  }
}

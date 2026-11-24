package com.awap.document.interfaces.api;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.document.application.DocumentScanSseService;
import com.awap.document.application.DocumentService;
import com.awap.document.application.MultipartUploadService;
import com.awap.document.domain.DocumentStatus;
import com.awap.document.domain.DocumentVersion;
import com.awap.document.domain.MultipartUploadStatus;
import com.awap.file.application.FileService;
import com.awap.file.application.FileService.FileScanInfo;
import com.awap.file.domain.FileScanStatus;
import com.awap.identity.IdentityApplication;
import com.awap.identity.infrastructure.security.TenantContext;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@SpringBootTest(classes = IdentityApplication.class)
class DocumentControllerWebMvcTest {

  private static final UUID TENANT = UUID.fromString("22222222-2222-2222-2222-222222222222");
  private static final UUID USER = UUID.fromString("33333333-3333-3333-3333-333333333333");

  @Autowired private WebApplicationContext context;
  @MockitoBean private DocumentService documentService;
  @MockitoBean private FileService fileService;
  @MockitoBean private DocumentScanSseService scanSseService;
  @MockitoBean private MultipartUploadService multipartUploadService;

  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    TenantContext.set(TENANT, USER, "MANAGER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void listProjectsTheTenantScopedScanStatusIntoEachVersion() throws Exception {
    UUID fileId = UUID.randomUUID();
    DocumentVersion version =
        new DocumentVersion(TENANT, fileId, 1, "awap-quarantine", "k", 12, "pdf");
    when(documentService.list(TENANT)).thenReturn(List.of(version));
    when(fileService.scanInfo(eq(TENANT), anyList()))
        .thenReturn(
            List.of(new FileScanInfo(fileId, "quarterly.pdf", FileScanStatus.PROMOTED, null)));

    mockMvc
        .perform(
            get("/api/v1/documents")
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fileId").value(fileId.toString()))
        .andExpect(jsonPath("$[0].name").value("quarterly.pdf"))
        .andExpect(jsonPath("$[0].scanStatus").value("PROMOTED"))
        .andExpect(jsonPath("$[0].downloadable").value(true))
        .andExpect(jsonPath("$[0].status").value(DocumentStatus.PENDING.name()));
  }

  @Test
  void eventsEndpointRequiresAuthentication() throws Exception {
    mockMvc.perform(get("/api/v1/documents/events")).andExpect(status().isUnauthorized());
  }

  @Test
  void eventsEndpointRequiresReadAuthority() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/documents/events")
                .with(user("employee").authorities(new SimpleGrantedAuthority("ROLE_EMPLOYEE"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void tenantWideEventsStreamStartsWithTheTenantSnapshot() throws Exception {
    UUID fileId = UUID.randomUUID();
    when(fileService.tenantScanInfo(TENANT))
        .thenReturn(List.of(new FileScanInfo(fileId, "a.pdf", FileScanStatus.SCANNING, null)));
    when(scanSseService.open(eq(TENANT), eq(USER), eq(null), anyList()))
        .thenReturn(new SseEmitter(1000L));

    mockMvc
        .perform(
            get("/api/v1/documents/events")
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(request().asyncStarted())
        .andExpect(status().isOk());
  }

  @Test
  void perFileEventsRejectACrossTenantFileWith404() throws Exception {
    UUID fileId = UUID.randomUUID();
    when(fileService.scanInfo(TENANT, fileId))
        .thenThrow(
            new AwapException(ErrorCode.FILE_NOT_FOUND, HttpStatus.NOT_FOUND, "File not found."));

    mockMvc
        .perform(
            get("/api/v1/documents/" + fileId + "/events")
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isNotFound());
  }

  @Test
  void retryScanReturnsTheRequeuedProjection() throws Exception {
    UUID fileId = UUID.randomUUID();
    when(fileService.retryScan(TENANT, fileId))
        .thenReturn(new FileScanInfo(fileId, "a.pdf", FileScanStatus.QUARANTINED, null));

    mockMvc
        .perform(
            post("/api/v1/documents/" + fileId + "/retry-scan")
                .with(csrf())
                .with(user("uploader").authorities(new SimpleGrantedAuthority("FILE_UPLOAD"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fileId").value(fileId.toString()))
        .andExpect(jsonPath("$.scanStatus").value("QUARANTINED"));
  }

  @Test
  void retryScanRequiresTheUploadAuthority() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/documents/" + UUID.randomUUID() + "/retry-scan")
                .with(csrf())
                .with(user("reader").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void retryScanOfANonFailedFileIsAConflict() throws Exception {
    UUID fileId = UUID.randomUUID();
    when(fileService.retryScan(TENANT, fileId))
        .thenThrow(
            new AwapException(
                ErrorCode.FILE_STATE_CONFLICT,
                HttpStatus.CONFLICT,
                "Only a failed antivirus scan can be retried."));

    mockMvc
        .perform(
            post("/api/v1/documents/" + fileId + "/retry-scan")
                .with(csrf())
                .with(user("uploader").authorities(new SimpleGrantedAuthority("FILE_UPLOAD"))))
        .andExpect(status().isConflict());
  }

  @Test
  void perFileEventsOpensOnlyAfterTheOwnershipCheck() throws Exception {
    UUID fileId = UUID.randomUUID();
    when(fileService.scanInfo(TENANT, fileId))
        .thenReturn(new FileScanInfo(fileId, "a.pdf", FileScanStatus.CLEAN, null));
    when(scanSseService.open(eq(TENANT), eq(USER), eq(fileId), anyList()))
        .thenReturn(new SseEmitter(1000L));

    mockMvc
        .perform(
            get("/api/v1/documents/" + fileId + "/events")
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(request().asyncStarted())
        .andExpect(status().isOk());
  }

  @Test
  void initiateMultipartReturnsThePartPlan() throws Exception {
    UUID uploadId = UUID.randomUUID();
    UUID fileId = UUID.randomUUID();
    String checksum = "a".repeat(64);
    when(multipartUploadService.initiate(
            eq(TENANT), eq("big.pdf"), eq("application/pdf"), eq(20L * 1024 * 1024), eq(checksum)))
        .thenReturn(
            new MultipartUploadService.InitiatedUpload(
                uploadId,
                fileId,
                8L * 1024 * 1024,
                3,
                Instant.parse("2026-12-01T00:00:00Z"),
                List.of(new MultipartUploadService.PartUrl(1, "https://minio/part-1", 300))));

    mockMvc
        .perform(
            post("/api/v1/documents/multipart")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"name\":\"big.pdf\",\"contentType\":\"application/pdf\",\"size\":"
                        + (20L * 1024 * 1024)
                        + ",\"sha256\":\""
                        + checksum
                        + "\"}")
                .with(csrf())
                .with(user("uploader").authorities(new SimpleGrantedAuthority("FILE_UPLOAD"))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.uploadId").value(uploadId.toString()))
        .andExpect(jsonPath("$.partCount").value(3))
        .andExpect(jsonPath("$.parts[0].url").value("https://minio/part-1"));
  }

  @Test
  void multipartStatusListsAcknowledgedParts() throws Exception {
    UUID uploadId = UUID.randomUUID();
    when(multipartUploadService.status(TENANT, uploadId))
        .thenReturn(
            new MultipartUploadService.UploadStatus(
                uploadId,
                MultipartUploadStatus.IN_PROGRESS,
                8L * 1024 * 1024,
                3,
                List.of(1, 2),
                20L * 1024 * 1024,
                Instant.parse("2026-12-01T00:00:00Z")));

    mockMvc
        .perform(
            get("/api/v1/documents/multipart/" + uploadId)
                .with(user("uploader").authorities(new SimpleGrantedAuthority("FILE_UPLOAD"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.acknowledgedParts[1]").value(2))
        .andExpect(jsonPath("$.status").value("IN_PROGRESS"));
  }

  @Test
  void multipartPartUrlIssuesAFreshSlot() throws Exception {
    UUID uploadId = UUID.randomUUID();
    when(multipartUploadService.presignPart(TENANT, uploadId, 2))
        .thenReturn(new MultipartUploadService.PartUrl(2, "https://minio/fresh", 300));

    mockMvc
        .perform(
            post("/api/v1/documents/multipart/" + uploadId + "/parts/2/url")
                .with(csrf())
                .with(user("uploader").authorities(new SimpleGrantedAuthority("FILE_UPLOAD"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.uploadId").value(uploadId.toString()))
        .andExpect(jsonPath("$.url").value("https://minio/fresh"));
  }

  @Test
  void multipartAcknowledgeReflectsTheServerObservation() throws Exception {
    UUID uploadId = UUID.randomUUID();
    when(multipartUploadService.acknowledgePart(TENANT, uploadId, 1))
        .thenReturn(
            new MultipartUploadService.UploadStatus(
                uploadId,
                MultipartUploadStatus.IN_PROGRESS,
                8L * 1024 * 1024,
                3,
                List.of(1),
                20L * 1024 * 1024,
                Instant.parse("2026-12-01T00:00:00Z")));

    mockMvc
        .perform(
            post("/api/v1/documents/multipart/" + uploadId + "/parts/1")
                .with(csrf())
                .with(user("uploader").authorities(new SimpleGrantedAuthority("FILE_UPLOAD"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.acknowledgedParts[0]").value(1));
  }

  @Test
  void multipartCompleteReturnsTheScannableFile() throws Exception {
    UUID uploadId = UUID.randomUUID();
    UUID fileId = UUID.randomUUID();
    when(multipartUploadService.complete(TENANT, uploadId, "b".repeat(64)))
        .thenReturn(
            new MultipartUploadService.CompletedUpload(
                fileId,
                "big.pdf",
                FileScanStatus.QUARANTINED,
                Instant.parse("2026-12-01T00:00:00Z")));
    DocumentVersion version =
        new DocumentVersion(TENANT, fileId, 1, "awap-documents", fileId + "/v1", 10, "pdf");
    when(documentService.registerPending(TENANT, fileId)).thenReturn(version);

    mockMvc
        .perform(
            post("/api/v1/documents/multipart/" + uploadId + "/complete")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sha256\":\"" + "b".repeat(64) + "\"}")
                .with(csrf())
                .with(user("uploader").authorities(new SimpleGrantedAuthority("FILE_UPLOAD"))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.fileId").value(fileId.toString()))
        .andExpect(jsonPath("$.status").value("QUARANTINED"))
        .andExpect(jsonPath("$.scanned").value(false))
        .andExpect(jsonPath("$.version").value(1));
  }

  @Test
  void multipartAbortAnswersNoContent() throws Exception {
    UUID uploadId = UUID.randomUUID();

    mockMvc
        .perform(
            delete("/api/v1/documents/multipart/" + uploadId)
                .with(csrf())
                .with(user("uploader").authorities(new SimpleGrantedAuthority("FILE_UPLOAD"))))
        .andExpect(status().isNoContent());

    org.mockito.Mockito.verify(multipartUploadService).abort(TENANT, uploadId);
  }
}

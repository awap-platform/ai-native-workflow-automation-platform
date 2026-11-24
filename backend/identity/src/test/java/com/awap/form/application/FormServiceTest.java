package com.awap.form.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.engine.application.OutboxEventPublisher;
import com.awap.form.domain.FormDefinition;
import com.awap.form.domain.FormSchemaSnapshot;
import com.awap.form.infrastructure.FormDefinitionRepository;
import com.awap.form.infrastructure.FormSchemaSnapshotRepository;
import com.awap.form.infrastructure.FormSubmissionRepository;
import com.awap.form.interfaces.dto.FormDefinitionRequest;
import com.awap.form.interfaces.dto.FormMapperImpl;
import com.awap.form.interfaces.dto.FormSchemaVersionResponse;
import com.awap.form.interfaces.dto.FormSubmissionRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FormServiceTest {

  @Mock private FormDefinitionRepository definitionRepository;
  @Mock private FormSubmissionRepository submissionRepository;
  @Mock private FormSchemaSnapshotRepository snapshotRepository;
  @Mock private OutboxEventPublisher outboxEventPublisher;
  @Mock private com.awap.file.application.FileService fileService;

  private FormService service;

  @BeforeEach
  void setUp() {
    service =
        new FormService(
            definitionRepository,
            submissionRepository,
            snapshotRepository,
            new ObjectMapper().findAndRegisterModules(),
            outboxEventPublisher,
            new FormMapperImpl(),
            fileService);
  }

  @Test
  void createRejectsInvalidSchema() {
    FormDefinitionRequest request =
        new FormDefinitionRequest("Form", "{\"fields\":[{\"type\":\"UNKNOWN\"}]}");

    assertThatThrownBy(() -> service.create(UUID.randomUUID(), request))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createPersistsAnImmutableSnapshotForTheNewVersion() {
    FormDefinitionRequest request =
        new FormDefinitionRequest("Form", "{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\"}]}");

    service.create(UUID.randomUUID(), request);

    verify(snapshotRepository).save(any(FormSchemaSnapshot.class));
  }

  @Test
  void updatePersistsTheNextVersionSnapshotAndLeavesTheOldOneUntouched() {
    UUID tenantId = UUID.randomUUID();
    UUID formId = UUID.randomUUID();
    FormDefinition definition =
        new FormDefinition(tenantId, "Form", "{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\"}]}");
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(formId, tenantId))
        .thenReturn(Optional.of(definition));

    service.update(
        tenantId,
        formId,
        new FormDefinitionRequest("Form", "{\"fields\":[{\"id\":\"email\",\"type\":\"EMAIL\"}]}"));

    verify(snapshotRepository, org.mockito.Mockito.times(1)).save(any(FormSchemaSnapshot.class));
  }

  @Test
  void getVersionReturnsTheRecordedSnapshot() {
    UUID tenantId = UUID.randomUUID();
    UUID formId = UUID.randomUUID();
    FormDefinition definition =
        new FormDefinition(tenantId, "Form", "{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\"}]}");
    FormSchemaSnapshot snapshot =
        new FormSchemaSnapshot(tenantId, formId, 2, definition.getSchemaJson(), "a".repeat(64));
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(formId, tenantId))
        .thenReturn(Optional.of(definition));
    when(snapshotRepository.findByFormIdAndVersionAndTenantId(formId, 2, tenantId))
        .thenReturn(Optional.of(snapshot));

    FormSchemaVersionResponse response = service.getVersion(tenantId, formId, 2);

    assertThat(response.version()).isEqualTo(2);
    assertThat(response.schemaHash()).isEqualTo("a".repeat(64));
    assertThat(response.schemaJson()).contains("\"name\"");
  }

  @Test
  void getVersionRejectsANonPositiveVersion() {
    assertThatThrownBy(() -> service.getVersion(UUID.randomUUID(), UUID.randomUUID(), 0))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void getVersionRejectsAMissingSnapshot() {
    UUID tenantId = UUID.randomUUID();
    UUID formId = UUID.randomUUID();
    FormDefinition definition =
        new FormDefinition(tenantId, "Form", "{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\"}]}");
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(formId, tenantId))
        .thenReturn(Optional.of(definition));
    when(snapshotRepository.findByFormIdAndVersionAndTenantId(formId, 3, tenantId))
        .thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.getVersion(tenantId, formId, 3))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("no schema snapshot");
  }

  @Test
  void submitRejectsMissingRequiredField() {
    UUID tenantId = UUID.randomUUID();
    UUID formId = UUID.randomUUID();
    FormDefinition definition =
        new FormDefinition(
            tenantId,
            "Form",
            "{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\",\"required\":true}]}");
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(formId, tenantId))
        .thenReturn(Optional.of(definition));

    FormSubmissionRequest request = new FormSubmissionRequest("{\"other\":\"x\"}", null, null);

    assertThatThrownBy(() -> service.submit(tenantId, formId, request, UUID.randomUUID()))
        .isInstanceOf(AwapException.class);
  }
}

package com.awap.form.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.engine.application.OutboxEventPublisher;
import com.awap.form.domain.FormDefinition;
import com.awap.form.domain.FormSubmission;
import com.awap.form.infrastructure.FormDefinitionRepository;
import com.awap.form.infrastructure.FormSubmissionRepository;
import com.awap.form.interfaces.dto.FormDefinitionRequest;
import com.awap.form.interfaces.dto.FormMapperImpl;
import com.awap.form.interfaces.dto.FormSubmissionRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

/**
 * Phase 6 server-side rules: conditional visibility, calculated fields, schema limits and the
 * recorded form version. The client mirrors these rules, but the server must still reject a bypass.
 */
@ExtendWith(MockitoExtension.class)
class FormServicePhase6Test {

  @Mock private FormDefinitionRepository definitionRepository;
  @Mock private FormSubmissionRepository submissionRepository;
  @Mock private OutboxEventPublisher outboxEventPublisher;
  @Mock private com.awap.file.application.FileService fileService;

  private FormService service;
  private final UUID tenantId = UUID.randomUUID();
  private final UUID formId = UUID.randomUUID();

  @BeforeEach
  void setUp() {
    service =
        new FormService(
            definitionRepository,
            submissionRepository,
            new ObjectMapper(),
            outboxEventPublisher,
            new FormMapperImpl(),
            fileService);
  }

  private FormDefinition givenSchema(String schemaJson) {
    FormDefinition definition = new FormDefinition(tenantId, "Form", schemaJson);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(formId, tenantId))
        .thenReturn(Optional.of(definition));
    return definition;
  }

  private void submit(String dataJson) {
    service.submit(
        tenantId, formId, new FormSubmissionRequest(dataJson, null, null), UUID.randomUUID());
  }

  @Test
  void hiddenRequiredFieldIsNotRequired() {
    givenSchema(
        "{\"fields\":["
            + "{\"id\":\"company\",\"type\":\"TEXT\"},"
            + "{\"id\":\"vat\",\"type\":\"TEXT\",\"required\":true,"
            + "\"visibleWhen\":{\"fieldId\":\"company\",\"operator\":\"IS_NOT_EMPTY\"}}]}");

    assertThatNoException().isThrownBy(() -> submit("{}"));
    assertThatThrownBy(() -> submit("{\"company\":\"Acme\"}")).isInstanceOf(AwapException.class);
  }

  @Test
  void hiddenFieldValueIsNotFormatValidated() {
    givenSchema(
        "{\"fields\":["
            + "{\"id\":\"choice\",\"type\":\"TEXT\"},"
            + "{\"id\":\"email\",\"type\":\"EMAIL\","
            + "\"visibleWhen\":{\"fieldId\":\"choice\",\"operator\":\"EQUALS\",\"value\":\"yes\"}}]}");

    assertThatNoException().isThrownBy(() -> submit("{\"email\":\"not-an-email\"}"));
    assertThatThrownBy(() -> submit("{\"choice\":\"yes\",\"email\":\"not-an-email\"}"))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void calculatedFieldAcceptsTheRecomputedValue() {
    givenSchema(
        "{\"fields\":["
            + "{\"id\":\"units\",\"type\":\"NUMBER\"},"
            + "{\"id\":\"price\",\"type\":\"NUMBER\"},"
            + "{\"id\":\"total\",\"type\":\"NUMBER\",\"calculated\":\"units * price\"}]}");

    assertThatNoException().isThrownBy(() -> submit("{\"units\":3,\"price\":2.5,\"total\":7.5}"));
  }

  @Test
  void calculatedFieldRejectsATamperedValue() {
    givenSchema(
        "{\"fields\":["
            + "{\"id\":\"units\",\"type\":\"NUMBER\"},"
            + "{\"id\":\"price\",\"type\":\"NUMBER\"},"
            + "{\"id\":\"total\",\"type\":\"NUMBER\",\"calculated\":\"units * price\"}]}");

    assertThatThrownBy(() -> submit("{\"units\":3,\"price\":2.5,\"total\":1}"))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void calculatedFieldRejectsATextValue() {
    givenSchema(
        "{\"fields\":["
            + "{\"id\":\"units\",\"type\":\"NUMBER\"},"
            + "{\"id\":\"total\",\"type\":\"NUMBER\",\"calculated\":\"units * 2\"}]}");

    assertThatThrownBy(() -> submit("{\"units\":3,\"total\":\"6\"}"))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createRejectsACalculationCycle() {
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Cyclic",
                        "{\"fields\":["
                            + "{\"id\":\"a\",\"type\":\"NUMBER\",\"calculated\":\"b + 1\"},"
                            + "{\"id\":\"b\",\"type\":\"NUMBER\",\"calculated\":\"a + 1\"}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createAcceptsSectionsAndDividers() {
    assertThatNoException()
        .isThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Layout",
                        "{\"fields\":["
                            + "{\"id\":\"intro\",\"type\":\"SECTION\",\"label\":\"Intro\"},"
                            + "{\"id\":\"name\",\"type\":\"TEXT\"},"
                            + "{\"id\":\"split\",\"type\":\"DIVIDER\"}]}")));
  }

  @Test
  void createRejectsARequiredLayoutField() {
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Bad layout",
                        "{\"fields\":[{\"id\":\"intro\",\"type\":\"SECTION\",\"required\":true}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createRejectsASelectWithoutOptions() {
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "No options", "{\"fields\":[{\"id\":\"tier\",\"type\":\"SELECT\"}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createRejectsAnInvalidPattern() {
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Bad regex",
                        "{\"fields\":[{\"id\":\"code\",\"type\":\"TEXT\",\"pattern\":\"[\"}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createRejectsDuplicateFieldIds() {
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Duplicates",
                        "{\"fields\":[{\"id\":\"a\",\"type\":\"TEXT\"},"
                            + "{\"id\":\"a\",\"type\":\"TEXT\"}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void numberAsTextIsRejected() {
    givenSchema("{\"fields\":[{\"id\":\"amount\",\"type\":\"NUMBER\"}]}");

    assertThatThrownBy(() -> submit("{\"amount\":\"5\"}")).isInstanceOf(AwapException.class);
  }

  @Test
  void textLongerThanTheHardCapIsRejected() {
    givenSchema("{\"fields\":[{\"id\":\"notes\",\"type\":\"TEXTAREA\"}]}");
    String longText = "x".repeat(10_001);

    assertThatThrownBy(() -> submit("{\"notes\":\"" + longText + "\"}"))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void oversizedSubmissionDataReturns413() {
    givenSchema("{\"fields\":[{\"id\":\"notes\",\"type\":\"TEXTAREA\"}]}");
    String huge = "{\"notes\":\"" + "x".repeat(1_000_001) + "\"}";

    assertThatThrownBy(() -> submit(huge))
        .isInstanceOfSatisfying(
            AwapException.class,
            ex -> assertThat(ex.status()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
  }

  @Test
  void oversizedSchemaReturns413() {
    String huge =
        "{\"fields\":[{\"id\":\"a\",\"type\":\"TEXT\",\"label\":\"" + "x".repeat(200_001) + "\"}]}";

    assertThatThrownBy(() -> service.create(tenantId, new FormDefinitionRequest("Huge", huge)))
        .isInstanceOfSatisfying(
            AwapException.class,
            ex -> assertThat(ex.status()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
  }

  @Test
  void submissionRecordsTheAnsweredDefinitionVersion() {
    FormDefinition definition = givenSchema("{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\"}]}");
    definition.updateSchema("Form", "{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\"}]}");
    definition.updateSchema("Form", "{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\"}]}");

    submit("{\"name\":\"Ada\"}");

    ArgumentCaptor<FormSubmission> captor = ArgumentCaptor.forClass(FormSubmission.class);
    verify(submissionRepository).save(captor.capture());
    assertThat(captor.getValue().getFormVersion()).isEqualTo(3);
  }

  @Test
  void createRejectsALabelOverTheLimit() {
    String label = "x".repeat(201);
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Long label",
                        "{\"fields\":[{\"id\":\"a\",\"type\":\"TEXT\",\"label\":\""
                            + label
                            + "\"}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createRejectsMinAboveMax() {
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Bounds",
                        "{\"fields\":[{\"id\":\"a\",\"type\":\"NUMBER\",\"min\":5,\"max\":1}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createRejectsACalculationOnANonNumberField() {
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Text calc",
                        "{\"fields\":[{\"id\":\"a\",\"type\":\"TEXT\",\"calculated\":\"1 + 1\"}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void createRejectsACalculationOnAnUnknownField() {
    assertThatThrownBy(
            () ->
                service.create(
                    tenantId,
                    new FormDefinitionRequest(
                        "Unknown calc",
                        "{\"fields\":[{\"id\":\"a\",\"type\":\"NUMBER\",\"calculated\":\"nope * 2\"}]}")))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void hiddenFileReferenceIsNeverResolved() {
    givenSchema(
        "{\"fields\":["
            + "{\"id\":\"flag\",\"type\":\"TEXT\"},"
            + "{\"id\":\"upload\",\"type\":\"FILE\","
            + "\"visibleWhen\":{\"fieldId\":\"flag\",\"operator\":\"IS_NOT_EMPTY\"}}]}");

    submit("{\"upload\":\"550e8400-e29b-41d4-a716-446655440000\"}");

    verifyNoInteractions(fileService);
    verify(submissionRepository).save(any(FormSubmission.class));
  }

  @Test
  void layoutFieldsDoNotNeedValues() {
    givenSchema(
        "{\"fields\":["
            + "{\"id\":\"intro\",\"type\":\"SECTION\",\"label\":\"Intro\"},"
            + "{\"id\":\"split\",\"type\":\"DIVIDER\"},"
            + "{\"id\":\"name\",\"type\":\"TEXT\"}]}");

    assertThatNoException().isThrownBy(() -> submit("{\"name\":\"Ada\"}"));
    verify(submissionRepository).save(any(FormSubmission.class));
  }
}

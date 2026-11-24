package com.awap.form.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.engine.application.NodeCompletedEvent;
import com.awap.engine.application.OutboxEventPublisher;
import com.awap.file.application.FileService;
import com.awap.file.application.FileService.SubmissionFile;
import com.awap.form.domain.FormDefinition;
import com.awap.form.domain.FormFieldType;
import com.awap.form.domain.FormSchemaSnapshot;
import com.awap.form.domain.FormSubmission;
import com.awap.form.infrastructure.FormDefinitionRepository;
import com.awap.form.infrastructure.FormSchemaSnapshotRepository;
import com.awap.form.infrastructure.FormSubmissionRepository;
import com.awap.form.interfaces.dto.FormDefinitionRequest;
import com.awap.form.interfaces.dto.FormDefinitionResponse;
import com.awap.form.interfaces.dto.FormMapper;
import com.awap.form.interfaces.dto.FormSchemaVersionResponse;
import com.awap.form.interfaces.dto.FormSubmissionFileResponse;
import com.awap.form.interfaces.dto.FormSubmissionRequest;
import com.awap.form.interfaces.dto.FormSubmissionResponse;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.google.common.hash.Hashing;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Form definition and submission use cases with server-side validation. */
@Service
public class FormService {

  private static final String EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";
  private static final String PHONE_PATTERN = "^\\+?[0-9\\s\\-()]{3,20}$";
  private static final String FIELD_ID_PATTERN = "^[A-Za-z_][A-Za-z0-9_]*$";

  /** Hard schema/data limits, mirrored in the frontend builder. */
  private static final int MAX_SCHEMA_CHARS = 200_000;

  private static final int MAX_DATA_CHARS = 1_000_000;
  private static final int MAX_TEXT_LENGTH = 10_000;
  private static final int MAX_LABEL_LENGTH = 200;
  private static final int MAX_HELP_LENGTH = 500;
  private static final int MAX_PATTERN_LENGTH = 200;
  private static final Set<String> LAYOUT_TYPES = Set.of("SECTION", "DIVIDER");

  private final FormDefinitionRepository definitionRepository;
  private final FormSubmissionRepository submissionRepository;
  private final FormSchemaSnapshotRepository snapshotRepository;
  private final ObjectMapper objectMapper;
  private final OutboxEventPublisher outboxEventPublisher;
  private final FormMapper formMapper;
  private final FileService fileService;

  public FormService(
      FormDefinitionRepository definitionRepository,
      FormSubmissionRepository submissionRepository,
      FormSchemaSnapshotRepository snapshotRepository,
      ObjectMapper objectMapper,
      OutboxEventPublisher outboxEventPublisher,
      FormMapper formMapper,
      FileService fileService) {
    this.definitionRepository = definitionRepository;
    this.submissionRepository = submissionRepository;
    this.snapshotRepository = snapshotRepository;
    this.objectMapper = objectMapper;
    this.outboxEventPublisher = outboxEventPublisher;
    this.formMapper = formMapper;
    this.fileService = fileService;
  }

  @Transactional
  public FormDefinitionResponse create(UUID tenantId, FormDefinitionRequest request) {
    validateSchema(request.schemaJson());
    FormDefinition definition = new FormDefinition(tenantId, request.name(), request.schemaJson());
    definitionRepository.save(definition);
    persistSnapshot(tenantId, definition);
    return formMapper.toResponse(definition);
  }

  @Transactional
  public FormDefinitionResponse update(UUID tenantId, UUID id, FormDefinitionRequest request) {
    validateSchema(request.schemaJson());
    FormDefinition definition = find(tenantId, id);
    definition.updateSchema(request.name(), request.schemaJson());
    persistSnapshot(tenantId, definition);
    return formMapper.toResponse(definition);
  }

  /** Reads the immutable schema snapshot recorded for a historical version (issue #370). */
  public FormSchemaVersionResponse getVersion(UUID tenantId, UUID id, int version) {
    if (version <= 0) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Form version must be positive.");
    }
    find(tenantId, id);
    FormSchemaSnapshot snapshot =
        snapshotRepository
            .findByFormIdAndVersionAndTenantId(id, version, tenantId)
            .orElseThrow(
                () ->
                    new AwapException(
                        ErrorCode.RESOURCE_NOT_FOUND,
                        HttpStatus.NOT_FOUND,
                        "Form version " + version + " has no schema snapshot."));
    return new FormSchemaVersionResponse(
        snapshot.getId(),
        snapshot.getFormId(),
        snapshot.getVersion(),
        snapshot.getSchemaJson(),
        snapshot.getSchemaHash(),
        snapshot.getCreatedAt());
  }

  private void persistSnapshot(UUID tenantId, FormDefinition definition) {
    snapshotRepository.save(
        new FormSchemaSnapshot(
            tenantId,
            definition.getId(),
            definition.getVersion(),
            definition.getSchemaJson(),
            sha256(definition.getSchemaJson())));
  }

  private String sha256(String value) {
    return Hashing.sha256().hashString(value, StandardCharsets.UTF_8).toString();
  }

  public List<FormDefinitionResponse> list(UUID tenantId) {
    return definitionRepository.findByTenantIdAndDeletedFalse(tenantId).stream()
        .map(formMapper::toResponse)
        .toList();
  }

  public FormDefinitionResponse get(UUID tenantId, UUID id) {
    return formMapper.toResponse(find(tenantId, id));
  }

  @Transactional
  public FormSubmissionResponse submit(
      UUID tenantId, UUID id, FormSubmissionRequest request, UUID submittedBy) {
    FormDefinition definition = find(tenantId, id);
    if (request.dataJson().length() > MAX_DATA_CHARS) {
      throw new AwapException(
          ErrorCode.PAYLOAD_TOO_LARGE,
          HttpStatus.PAYLOAD_TOO_LARGE,
          "Submission data exceeds the allowed size.");
    }
    JsonNode schema = readJson(definition.getSchemaJson(), "Form schema is not valid JSON.");
    JsonNode data = readJson(request.dataJson(), "Submission data is not valid JSON.");
    validateData(schema, data);
    List<SubmissionFile> acceptedFiles = acceptedFiles(tenantId, schema, data);
    FormSubmission submission =
        new FormSubmission(
            tenantId,
            id,
            definition.getVersion(),
            request.workflowInstanceId(),
            request.dataJson(),
            submittedBy);
    submissionRepository.save(submission);

    if (request.workflowInstanceId() != null && request.nodeExecutionId() != null) {
      outboxEventPublisher.publish(
          tenantId,
          "FORM",
          submission.getId(),
          "FORM_SUBMITTED",
          new NodeCompletedEvent(
              tenantId,
              request.workflowInstanceId(),
              request.nodeExecutionId(),
              request.dataJson()));
    }
    if (!acceptedFiles.isEmpty()) {
      outboxEventPublisher.publish(
          tenantId,
          "FORM",
          submission.getId(),
          "FORM_FILES_SUBMITTED",
          new FormFilesSubmittedEvent(
              submission.getId(),
              id,
              acceptedFiles.stream()
                  .map(
                      file ->
                          new FormFilesSubmittedEvent.FileReference(
                              file.fileId(),
                              file.name(),
                              file.size(),
                              file.contentType(),
                              file.status().name()))
                  .toList()));
    }
    return formMapper.toResponse(submission).withFiles(toFileResponses(acceptedFiles));
  }

  public List<FormSubmissionResponse> submissions(UUID tenantId, UUID id) {
    find(tenantId, id);
    return submissionRepository.findByTenantIdAndFormIdOrderByCreatedAtDesc(tenantId, id).stream()
        .map(formMapper::toResponse)
        .toList();
  }

  private FormDefinition find(UUID tenantId, UUID id) {
    return definitionRepository
        .findByIdAndTenantIdAndDeletedFalse(id, tenantId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND, "Form not found."));
  }

  private void validateSchema(String schemaJson) {
    if (schemaJson.length() > MAX_SCHEMA_CHARS) {
      throw new AwapException(
          ErrorCode.PAYLOAD_TOO_LARGE,
          HttpStatus.PAYLOAD_TOO_LARGE,
          "Form schema exceeds the allowed size.");
    }
    JsonNode schema;
    try {
      schema = objectMapper.readTree(schemaJson);
    } catch (JsonProcessingException ex) {
      throw invalidSchema();
    }
    JsonNode fields = schema == null ? null : schema.get("fields");
    if (fields == null || !fields.isArray() || fields.isEmpty()) {
      throw invalidSchema();
    }
    Set<String> ids = new HashSet<>();
    for (JsonNode field : fields) {
      String id = field.path("id").asText("");
      String type = field.path("type").asText("");
      if (id.isBlank() || !id.matches(FIELD_ID_PATTERN) || !ids.add(id)) {
        throw invalidSchema();
      }
      if (!isSupportedType(type)) {
        throw invalidSchema();
      }
    }
    for (JsonNode field : fields) {
      checkField(field, ids);
    }
    List<String> cycle = FormRules.calculationCycle(fields);
    if (cycle != null) {
      throw invalidSchemaDetail(
          "Form schema has a circular calculation: " + String.join(" -> ", cycle) + ".");
    }
  }

  /** Field-level schema checks that need the complete id set (references, options, expressions). */
  private void checkField(JsonNode field, Set<String> ids) {
    String id = field.path("id").asText("");
    String type = field.path("type").asText("");
    String label = field.path("label").asText("");
    String help = field.path("help").asText("");
    if (label.length() > MAX_LABEL_LENGTH || help.length() > MAX_HELP_LENGTH) {
      throw invalidSchema();
    }
    if (LAYOUT_TYPES.contains(type)) {
      if (field.path("required").asBoolean(false)) {
        throw invalidSchemaDetail("Layout field '" + id + "' cannot be required.");
      }
      return;
    }
    if ("SELECT".equals(type) || "MULTI_SELECT".equals(type)) {
      JsonNode options = field.get("options");
      if (options == null || !options.isArray() || options.isEmpty()) {
        throw invalidSchemaDetail("Field '" + id + "' needs at least one option.");
      }
      for (JsonNode option : options) {
        if (!option.isTextual() || option.asText().isBlank()) {
          throw invalidSchemaDetail("Field '" + id + "' has an empty option.");
        }
      }
    }
    int minLength = field.path("minLength").asInt(-1);
    int maxLength = field.path("maxLength").asInt(-1);
    if (maxLength > MAX_TEXT_LENGTH) {
      throw invalidSchemaDetail("Field '" + id + "' exceeds the text length limit.");
    }
    if (minLength >= 0 && maxLength >= 0 && minLength > maxLength) {
      throw invalidSchemaDetail("Field '" + id + "' has min length above max length.");
    }
    if (field.has("min")
        && field.has("max")
        && field.get("min").isNumber()
        && field.get("max").isNumber()
        && field.get("min").asDouble() > field.get("max").asDouble()) {
      throw invalidSchemaDetail("Field '" + id + "' has min above max.");
    }
    String pattern = field.path("pattern").asText("");
    if (!pattern.isEmpty()) {
      if (pattern.length() > MAX_PATTERN_LENGTH) {
        throw invalidSchemaDetail("Field '" + id + "' pattern is too long.");
      }
      try {
        Pattern.compile(pattern);
      } catch (PatternSyntaxException ex) {
        throw invalidSchemaDetail("Field '" + id + "' pattern is not a valid regex.");
      }
    }
    JsonNode rule = field.get("visibleWhen");
    if (rule != null && !rule.isNull()) {
      if (!rule.isObject()) {
        throw invalidSchema();
      }
      String reference = rule.path("fieldId").asText("");
      if (reference.equals(id)) {
        throw invalidSchemaDetail("Field '" + id + "' cannot depend on itself.");
      }
      if (!ids.contains(reference)) {
        throw invalidSchemaDetail(
            "Field '" + id + "' depends on the unknown field '" + reference + "'.");
      }
      String operator = rule.path("operator").asText("");
      if (!Set.of(
              "EQUALS",
              "NOT_EQUALS",
              "CONTAINS",
              "GREATER_THAN",
              "LESS_THAN",
              "IS_EMPTY",
              "IS_NOT_EMPTY")
          .contains(operator)) {
        throw invalidSchema();
      }
    }
    String calculated = field.path("calculated").asText("");
    if (!calculated.isBlank()) {
      if (!"NUMBER".equals(type)) {
        throw invalidSchemaDetail("Field '" + id + "' must be NUMBER to use a calculation.");
      }
      List<String> dependencies;
      try {
        dependencies = FormExpressions.dependencies(calculated);
      } catch (FormExpressions.InvalidExpressionException ex) {
        throw invalidSchemaDetail("Field '" + id + "' calculation is invalid.");
      }
      for (String dependency : dependencies) {
        if (dependency.equals(id)) {
          throw invalidSchemaDetail("Field '" + id + "' cannot use itself in its calculation.");
        }
        if (!ids.contains(dependency)) {
          throw invalidSchemaDetail(
              "Field '" + id + "' calculation references the unknown field '" + dependency + "'.");
        }
      }
    }
  }

  private boolean isSupportedType(String type) {
    for (FormFieldType fieldType : FormFieldType.values()) {
      if (fieldType.name().equals(type)) {
        return true;
      }
    }
    return false;
  }

  private void validateData(JsonNode schema, JsonNode data) {
    if (data == null || !data.isObject()) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED,
          HttpStatus.BAD_REQUEST,
          "Submission data must be a JSON object.");
    }
    JsonNode fields = schema.get("fields");
    if (fields == null || !fields.isArray()) {
      return;
    }
    Map<String, String> values = FormRules.valuesOf(data);
    for (JsonNode field : fields) {
      String type = field.path("type").asText("");
      // A hidden field is neither required nor validated, exactly like the renderer.
      if (LAYOUT_TYPES.contains(type) || !FormRules.isVisible(field, data)) {
        continue;
      }
      String fieldId = field.path("id").asText(null);
      boolean required = field.path("required").asBoolean(false);
      if (required && isEmptyValue(data.get(fieldId))) {
        throw new AwapException(
            ErrorCode.VALIDATION_FAILED,
            HttpStatus.BAD_REQUEST,
            "Required field '" + fieldId + "' is missing.");
      }
      JsonNode value = fieldId == null ? null : data.get(fieldId);
      if (value == null || value.isNull()) {
        continue;
      }
      String calculated = field.path("calculated").asText("");
      if (!calculated.isBlank()) {
        verifyCalculated(fieldId, calculated, value, values);
      }

      if ("TEXT".equals(type) || "TEXTAREA".equals(type) || value.isTextual()) {
        String text = value.asText();
        int minLength = field.path("minLength").asInt(-1);
        int maxLength = field.path("maxLength").asInt(-1);
        if (minLength >= 0 && text.length() < minLength) {
          throw new AwapException(
              ErrorCode.VALIDATION_FAILED,
              HttpStatus.BAD_REQUEST,
              "Field '" + fieldId + "' is shorter than " + minLength + " characters.");
        }
        if (maxLength >= 0 && text.length() > maxLength) {
          throw new AwapException(
              ErrorCode.VALIDATION_FAILED,
              HttpStatus.BAD_REQUEST,
              "Field '" + fieldId + "' is longer than " + maxLength + " characters.");
        }
        // Hard cap even when the schema does not set maxLength.
        if (text.length() > MAX_TEXT_LENGTH) {
          throw new AwapException(
              ErrorCode.VALIDATION_FAILED,
              HttpStatus.BAD_REQUEST,
              "Field '" + fieldId + "' is longer than " + MAX_TEXT_LENGTH + " characters.");
        }
        String pattern = field.path("pattern").asText("");
        if (!pattern.isEmpty() && !text.matches(pattern)) {
          throw new AwapException(
              ErrorCode.VALIDATION_FAILED,
              HttpStatus.BAD_REQUEST,
              "Field '" + fieldId + "' does not match the required pattern.");
        }
      }

      if ("NUMBER".equals(type)) {
        if (!value.isNumber()) {
          throw invalidField(fieldId, "must be a number.");
        }
        double number = value.asDouble();
        if (field.has("min")
            && field.get("min").isNumber()
            && number < field.get("min").asDouble()) {
          throw new AwapException(
              ErrorCode.VALIDATION_FAILED,
              HttpStatus.BAD_REQUEST,
              "Field '" + fieldId + "' is below the minimum.");
        }
        if (field.has("max")
            && field.get("max").isNumber()
            && number > field.get("max").asDouble()) {
          throw new AwapException(
              ErrorCode.VALIDATION_FAILED,
              HttpStatus.BAD_REQUEST,
              "Field '" + fieldId + "' is above the maximum.");
        }
      }

      validateByType(field, value);
    }
  }

  /** A calculated value must match the server-side recomputation from the submitted values. */
  private void verifyCalculated(
      String fieldId, String expression, JsonNode value, Map<String, String> values) {
    if (!value.isNumber()) {
      throw invalidField(fieldId, "must be a number.");
    }
    Double expected = FormExpressions.evaluate(expression, values);
    if (expected == null) {
      return;
    }
    if (Math.abs(value.asDouble() - expected) > 1e-9) {
      throw invalidField(fieldId, "must equal the calculated value " + expected + ".");
    }
  }

  private boolean isEmptyValue(JsonNode value) {
    if (value == null || value.isNull()) {
      return true;
    }
    if (value.isTextual()) {
      return value.asText().isBlank();
    }
    return value.isArray() && value.isEmpty();
  }

  /** Applies built-in, type-specific format validation for the typed field kinds. */
  private void validateByType(JsonNode field, JsonNode value) {
    String type = field.path("type").asText(null);
    String fieldId = field.path("id").asText(null);
    switch (type) {
      case "EMAIL" -> {
        if (!value.isTextual() || !value.asText().matches(EMAIL_PATTERN)) {
          throw invalidField(fieldId, "must be a valid email address.");
        }
      }
      case "PHONE" -> {
        if (!value.isTextual() || !value.asText().matches(PHONE_PATTERN)) {
          throw invalidField(fieldId, "must be a valid phone number.");
        }
      }
      case "DATE" -> {
        if (!value.isTextual() || !isIsoDate(value.asText())) {
          throw invalidField(fieldId, "must be a valid ISO date (YYYY-MM-DD).");
        }
      }
      case "DATETIME" -> {
        if (!value.isTextual() || !isIsoDateTime(value.asText())) {
          throw invalidField(fieldId, "must be a valid ISO-8601 date-time.");
        }
      }
      case "BOOLEAN" -> {
        if (!value.isBoolean()) {
          throw invalidField(fieldId, "must be a boolean.");
        }
      }
      case "SELECT" -> {
        if (!value.isTextual() || !matchesOptions(field, value.asText())) {
          throw invalidField(fieldId, "must be one of the allowed options.");
        }
      }
      case "MULTI_SELECT" -> {
        if (!value.isArray() || !allMatchOptions(field, value)) {
          throw invalidField(fieldId, "must contain only allowed options.");
        }
      }
      case "FILE" -> {
        if (fileIdsOf(value).isEmpty()) {
          throw invalidField(
              fieldId, "must reference an uploaded file id (fileId) or a non-empty fileIds array.");
        }
      }
      default -> {
        // TEXT, TEXTAREA and NUMBER are validated inline; no extra type rules apply.
      }
    }
  }

  private JsonNode readJson(String json, String errorMessage) {
    try {
      JsonNode node = objectMapper.readTree(json);
      // Jackson returns null for empty content; a missing node keeps the downstream `path` calls
      // null-safe and makes an empty payload fail the JSON-object check.
      return node == null ? MissingNode.getInstance() : node;
    } catch (JsonProcessingException ex) {
      throw new AwapException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, errorMessage);
    }
  }

  /**
   * Resolves and validates every FILE field of a submission against the file module. Missing,
   * foreign, pending, infected, oversized or unsupported files fail the whole submission before the
   * row is written, so a broken reference can never be persisted.
   */
  private List<SubmissionFile> acceptedFiles(UUID tenantId, JsonNode schema, JsonNode data) {
    return collectFileIds(schema, data).stream()
        .map(fileId -> fileService.submissionFile(tenantId, fileId))
        .toList();
  }

  private Set<UUID> collectFileIds(JsonNode schema, JsonNode data) {
    Set<UUID> fileIds = new LinkedHashSet<>();
    JsonNode fields = schema.path("fields");
    if (!fields.isArray()) {
      return fileIds;
    }
    for (JsonNode field : fields) {
      if (!FormFieldType.FILE.name().equals(field.path("type").asText(null))
          || !FormRules.isVisible(field, data)) {
        continue;
      }
      String fieldId = field.path("id").asText("");
      JsonNode value = data.get(fieldId);
      if (value == null) {
        continue;
      }
      for (String rawId : fileIdsOf(value)) {
        try {
          fileIds.add(UUID.fromString(rawId));
        } catch (IllegalArgumentException ex) {
          throw invalidField(fieldId, "must reference a valid file id (UUID).");
        }
      }
    }
    return fileIds;
  }

  /** Accepts the single {@code fileId} string or the {@code fileIds} array form of a FILE field. */
  private List<String> fileIdsOf(JsonNode value) {
    if (value == null || value.isNull()) {
      return List.of();
    }
    if (value.isTextual()) {
      return value.asText().isBlank() ? List.of() : List.of(value.asText().trim());
    }
    if (!value.isArray()) {
      return List.of();
    }
    List<String> ids = new java.util.ArrayList<>();
    for (JsonNode item : value) {
      if (!item.isTextual() || item.asText().isBlank()) {
        return List.of();
      }
      ids.add(item.asText().trim());
    }
    return ids;
  }

  private List<FormSubmissionFileResponse> toFileResponses(List<SubmissionFile> files) {
    return files.stream()
        .map(
            file ->
                new FormSubmissionFileResponse(
                    file.fileId(),
                    file.name(),
                    file.size(),
                    file.contentType(),
                    file.status().name()))
        .toList();
  }

  private boolean isIsoDate(String text) {
    try {
      LocalDate.parse(text);
      return true;
    } catch (DateTimeParseException ex) {
      return false;
    }
  }

  private boolean isIsoDateTime(String text) {
    try {
      OffsetDateTime.parse(text);
      return true;
    } catch (DateTimeParseException ex) {
      return false;
    }
  }

  private boolean matchesOptions(JsonNode field, String selected) {
    JsonNode options = field.get("options");
    if (options == null || !options.isArray() || options.isEmpty()) {
      return true;
    }
    for (JsonNode option : options) {
      if (selected.equals(option.asText(null))) {
        return true;
      }
    }
    return false;
  }

  private boolean allMatchOptions(JsonNode field, JsonNode values) {
    JsonNode options = field.get("options");
    if (options == null || !options.isArray() || options.isEmpty()) {
      return true;
    }
    for (JsonNode value : values) {
      if (!value.isTextual() || !matchesOptions(field, value.asText())) {
        return false;
      }
    }
    return true;
  }

  private AwapException invalidField(String fieldId, String message) {
    return new AwapException(
        ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Field '" + fieldId + "' " + message);
  }

  private AwapException invalidSchema() {
    return new AwapException(
        ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Form schema JSON is invalid.");
  }

  private AwapException invalidSchemaDetail(String detail) {
    return new AwapException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, detail);
  }
}

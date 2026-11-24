package com.awap.form.interfaces.dto;

import java.time.Instant;
import java.util.UUID;

/** Immutable schema snapshot for a historical form version (issue #370). */
public record FormSchemaVersionResponse(
    UUID id, UUID formId, int version, String schemaJson, String schemaHash, Instant createdAt) {}

package com.awap.workflow.interfaces.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

/**
 * Request to update an existing DRAFT in place. The client sends the {@code updatedAt} token it
 * loaded; a mismatch is a 409 so two tabs can never silently overwrite each other.
 */
public record WorkflowDefinitionUpdateRequest(
    @NotBlank(message = "name is required") String name,
    String description,
    @NotBlank(message = "definitionJson is required") String definitionJson,
    @NotNull(message = "expectedUpdatedAt is required") Instant expectedUpdatedAt) {}

package com.awap.workflow.interfaces.dto;

import jakarta.validation.constraints.NotBlank;

/** Internal definition JSON submitted for conversion to BPMN 2.0 XML. */
public record BpmnExportRequest(
    @NotBlank(message = "definitionJson is required") String definitionJson) {}

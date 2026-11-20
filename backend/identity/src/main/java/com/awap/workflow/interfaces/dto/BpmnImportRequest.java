package com.awap.workflow.interfaces.dto;

import jakarta.validation.constraints.NotBlank;

/** BPMN 2.0 XML submitted for conversion to the internal definition JSON. */
public record BpmnImportRequest(@NotBlank(message = "bpmnXml is required") String bpmnXml) {}

package com.awap.workflow.interfaces.dto;

import java.util.List;

/**
 * Internal definition JSON produced from BPMN. {@code warnings} lists constructs that were
 * deliberately ignored because the engine has no equivalent.
 */
public record BpmnImportResponse(String definitionJson, List<String> warnings) {}

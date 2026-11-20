package com.awap.workflow.interfaces.dto;

/** BPMN 2.0 XML produced from a definition, plus the constructs that could not be represented. */
public record BpmnExportResponse(String bpmnXml) {}

package com.awap.workflow.interfaces.api;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.workflow.application.BpmnXmlService;
import com.awap.workflow.interfaces.dto.BpmnExportRequest;
import com.awap.workflow.interfaces.dto.BpmnExportResponse;
import com.awap.workflow.interfaces.dto.BpmnImportRequest;
import com.awap.workflow.interfaces.dto.BpmnImportResponse;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * BPMN 2.0 interchange for the workflow designer.
 *
 * <p>The endpoints convert between BPMN XML and the internal definition JSON without persisting
 * anything, so unsaved drafts can be exported and imported BPMN can be inspected before a save.
 * Both calls require a tenant context, which keeps the additive module tenant-scoped even though it
 * does not touch the database.
 */
@RestController
@RequestMapping("/api/v1/workflow-definitions/bpmn")
public class WorkflowBpmnController {

  private final BpmnXmlService bpmnXmlService;

  public WorkflowBpmnController(BpmnXmlService bpmnXmlService) {
    this.bpmnXmlService = bpmnXmlService;
  }

  @PostMapping("/import")
  @PreAuthorize("hasAuthority('WORKFLOW_CREATE')")
  public ResponseEntity<BpmnImportResponse> importBpmn(
      @Valid @RequestBody BpmnImportRequest request) {
    currentTenantId();
    BpmnXmlService.ImportResult result = bpmnXmlService.importDefinition(request.bpmnXml());
    return ResponseEntity.ok(new BpmnImportResponse(result.definitionJson(), result.warnings()));
  }

  @PostMapping("/export")
  @PreAuthorize("hasAuthority('WORKFLOW_CREATE')")
  public ResponseEntity<BpmnExportResponse> exportBpmn(
      @Valid @RequestBody BpmnExportRequest request) {
    currentTenantId();
    return ResponseEntity.ok(
        new BpmnExportResponse(bpmnXmlService.exportDefinition(request.definitionJson())));
  }

  private UUID currentTenantId() {
    return TenantContext.current()
        .map(TenantContext.Context::tenantId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.UNAUTHORIZED,
                    HttpStatus.UNAUTHORIZED,
                    "Authentication is required."));
  }
}

package com.awap.engine.interfaces.api;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.engine.application.ReplayService;
import com.awap.engine.application.WorkflowEngineService;
import com.awap.engine.interfaces.dto.ExecutionLogResponse;
import com.awap.engine.interfaces.dto.ReplayReport;
import com.awap.engine.interfaces.dto.StartWorkflowRequest;
import com.awap.engine.interfaces.dto.WorkflowInstanceResponse;
import com.awap.identity.infrastructure.security.TenantContext;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Workflow instance endpoints: start, list, get, logs and state transitions. */
@RestController
@RequestMapping("/api/v1/workflow-instances")
public class WorkflowInstanceController {

  private final WorkflowEngineService engineService;
  private final ReplayService replayService;

  public WorkflowInstanceController(
      WorkflowEngineService engineService, ReplayService replayService) {
    this.engineService = engineService;
    this.replayService = replayService;
  }

  @PostMapping
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> start(
      @Valid @RequestBody StartWorkflowRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(engineService.start(currentTenantId(), request));
  }

  /**
   * Lists instances newest first. Without {@code limit} the full tenant list is returned (existing
   * callers); with it the response is one page and {@code X-Total-Count} carries the full size so
   * the monitor can paginate without a second request.
   */
  @GetMapping
  @PreAuthorize("hasAuthority('INSTANCE_READ')")
  public ResponseEntity<List<WorkflowInstanceResponse>> list(
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset) {
    List<WorkflowInstanceResponse> all = engineService.list(currentTenantId());
    if (limit == null) {
      return ResponseEntity.ok(all);
    }
    int size = Math.max(0, limit);
    int from = Math.min(all.size(), Math.max(0, offset == null ? 0 : offset));
    int to = Math.min(all.size(), from + size);
    List<WorkflowInstanceResponse> page = List.copyOf(all.subList(from, to));
    return ResponseEntity.ok().header("X-Total-Count", String.valueOf(all.size())).body(page);
  }

  @GetMapping("/{id}")
  @PreAuthorize("hasAuthority('INSTANCE_READ')")
  public ResponseEntity<WorkflowInstanceResponse> get(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.get(currentTenantId(), id));
  }

  @GetMapping("/{id}/logs")
  @PreAuthorize("hasAuthority('INSTANCE_READ')")
  public ResponseEntity<List<ExecutionLogResponse>> logs(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.logs(currentTenantId(), id));
  }

  @PostMapping("/{id}/nodes/{nodeId}/complete")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> completeNode(
      @PathVariable UUID id,
      @PathVariable String nodeId,
      @RequestBody(required = false) CompleteNodeRequest request) {
    String outputJson =
        request == null || request.outputJson() == null ? "{}" : request.outputJson();
    return ResponseEntity.ok(engineService.completeNode(currentTenantId(), id, nodeId, outputJson));
  }

  @PostMapping("/{id}/complete")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> complete(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.complete(currentTenantId(), id));
  }

  @PostMapping("/{id}/retry")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> retry(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.retry(currentTenantId(), id));
  }

  /**
   * Deterministic replay. {@code dryRun=true} returns the projection report and writes nothing but
   * the audit row; without {@code dryRun} the reference replay runs after the projection matched.
   */
  @PostMapping(value = "/{id}/replay", params = "dryRun=true")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<ReplayReport> replayDryRun(@PathVariable UUID id) {
    return ResponseEntity.ok(replayService.dryRun(currentTenantId(), id, currentUserId()));
  }

  @PostMapping("/{id}/replay")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> replay(@PathVariable UUID id) {
    return ResponseEntity.ok(replayService.replay(currentTenantId(), id, currentUserId()));
  }

  @PostMapping("/{id}/recover")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> recover(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.recover(currentTenantId(), id));
  }

  @PostMapping("/{id}/fail")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> fail(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.fail(currentTenantId(), id));
  }

  @PostMapping("/{id}/cancel")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> cancel(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.cancel(currentTenantId(), id));
  }

  @PostMapping("/{id}/pause")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> pause(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.pause(currentTenantId(), id));
  }

  @PostMapping("/{id}/resume")
  @PreAuthorize("hasAuthority('INSTANCE_MANAGE')")
  public ResponseEntity<WorkflowInstanceResponse> resume(@PathVariable UUID id) {
    return ResponseEntity.ok(engineService.resume(currentTenantId(), id));
  }

  /** Request body for completing a node with an optional JSON output. */
  public record CompleteNodeRequest(String outputJson) {}

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

  private Optional<UUID> currentUserId() {
    return TenantContext.current().map(TenantContext.Context::userId);
  }
}

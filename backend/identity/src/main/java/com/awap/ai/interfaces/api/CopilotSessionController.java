package com.awap.ai.interfaces.api;

import com.awap.ai.application.CopilotSessionService;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.infrastructure.security.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Server-side Copilot history (issue #373). These endpoints are what make a conversation survive a
 * reload, a second device and a crash: the thread, its turns and pending approvals all live here.
 */
@RestController
@RequestMapping("/api/v1/copilot/sessions")
public class CopilotSessionController {

  private final CopilotSessionService service;

  public CopilotSessionController(CopilotSessionService service) {
    this.service = service;
  }

  @PostMapping
  public ResponseEntity<CopilotSessionService.SessionView> create(
      @Valid @RequestBody CreateSessionRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.create(currentTenantId(), currentUserId(), request.title()));
  }

  @GetMapping
  public ResponseEntity<CopilotSessionService.SessionPage> list(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
    return ResponseEntity.ok(service.list(currentTenantId(), page, size));
  }

  @GetMapping("/{id}")
  public ResponseEntity<CopilotSessionService.ThreadView> get(@PathVariable UUID id) {
    return ResponseEntity.ok(service.get(currentTenantId(), id));
  }

  @PostMapping("/{id}/turns")
  public ResponseEntity<CopilotSessionService.TurnView> appendTurn(
      @PathVariable UUID id,
      @Valid @RequestBody AppendTurnRequest request,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            service.appendTurn(
                currentTenantId(),
                id,
                request.role(),
                request.content(),
                idempotencyKey,
                request.toolCallsJson(),
                request.citationsJson(),
                request.budgetJson(),
                request.approvalJson()));
  }

  @PostMapping("/{id}/hitl")
  public ResponseEntity<CopilotSessionService.HitlView> openHitl(
      @PathVariable UUID id, @Valid @RequestBody OpenHitlRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            service.openHitl(
                currentTenantId(),
                id,
                request.turnId(),
                request.summary(),
                request.proposalJson()));
  }

  @PostMapping("/{id}/hitl/{hitlId}/decision")
  public ResponseEntity<CopilotSessionService.HitlView> decideHitl(
      @PathVariable UUID id,
      @PathVariable UUID hitlId,
      @Valid @RequestBody DecideHitlRequest request) {
    UUID tenantId = currentTenantId();
    // Reading the thread first makes a foreign session id a 404 instead of a silent approval.
    service.get(tenantId, id);
    return ResponseEntity.ok(
        service.decideHitl(tenantId, hitlId, request.decision(), currentUserId()));
  }

  @GetMapping("/{id}/export")
  public ResponseEntity<CopilotSessionService.ExportView> export(@PathVariable UUID id) {
    return ResponseEntity.ok(service.export(currentTenantId(), id, currentUserId()));
  }

  @DeleteMapping("/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void archive(@PathVariable UUID id) {
    service.archive(currentTenantId(), id);
  }

  private TenantContext.Context context() {
    return TenantContext.current()
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.UNAUTHORIZED,
                    HttpStatus.UNAUTHORIZED,
                    "Authentication is required."));
  }

  private UUID currentTenantId() {
    return context().tenantId();
  }

  private UUID currentUserId() {
    return context().userId();
  }

  /** Request to open a conversation. */
  public record CreateSessionRequest(@NotBlank String title) {}

  /** Request to append one turn; tool calls, citations and budget travel with it. */
  public record AppendTurnRequest(
      @NotBlank String role,
      @NotBlank String content,
      String toolCallsJson,
      String citationsJson,
      String budgetJson,
      String approvalJson) {}

  /** Request to persist a pending human approval. */
  public record OpenHitlRequest(UUID turnId, @NotBlank String summary, String proposalJson) {}

  /** Request to record the review decision. */
  public record DecideHitlRequest(@NotBlank String decision) {}
}

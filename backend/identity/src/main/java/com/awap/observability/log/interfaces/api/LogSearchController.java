package com.awap.observability.log.interfaces.api;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.observability.log.application.LogSearchQuery;
import com.awap.observability.log.application.LogSearchResult;
import com.awap.observability.log.application.LogSearchService;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Tenant-scoped log search by correlation ID (issue #286). */
@RestController
@RequestMapping("/api/v1/logs")
public class LogSearchController {

  private final LogSearchService searchService;

  public LogSearchController(LogSearchService searchService) {
    this.searchService = searchService;
  }

  @GetMapping("/search")
  @PreAuthorize("hasAuthority('INSTANCE_READ')")
  public ResponseEntity<LogSearchResult> search(
      @RequestParam(required = false) String correlationId,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant to,
      @RequestParam(required = false) Integer limit) {
    LogSearchQuery query = LogSearchQuery.of(correlationId, from, to, limit);
    LogSearchResult result = searchService.search(requireTenantId(), query);
    if (!result.available()) {
      throw new AwapException(
          ErrorCode.GENERIC_INTERNAL_ERROR,
          HttpStatus.SERVICE_UNAVAILABLE,
          "Log search is temporarily unavailable.");
    }
    return ResponseEntity.ok(result);
  }

  private static UUID requireTenantId() {
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

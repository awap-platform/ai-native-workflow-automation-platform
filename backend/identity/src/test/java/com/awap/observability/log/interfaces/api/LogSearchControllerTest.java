package com.awap.observability.log.interfaces.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.observability.log.application.LogSearchQuery;
import com.awap.observability.log.application.LogSearchResult;
import com.awap.observability.log.application.LogSearchService;
import com.awap.observability.log.domain.LogEvent;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class LogSearchControllerTest {

  private static final UUID TENANT = UUID.randomUUID();
  private static final UUID USER = UUID.randomUUID();

  private final LogSearchService service = mock(LogSearchService.class);
  private final LogSearchController controller = new LogSearchController(service);

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT, USER, "MEMBER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void returnsTheTenantScopedResult() {
    LogEvent event =
        new LogEvent(
            TENANT.toString(), "ai-layer", "INFO", "log", "hello", "c", "t", Instant.EPOCH);
    when(service.search(eq(TENANT), any(LogSearchQuery.class)))
        .thenReturn(new LogSearchResult(true, 1, List.of(event)));

    LogSearchResult result = controller.search("c", null, null, 5).getBody();

    assertThat(result).isNotNull();
    assertThat(result.logs()).containsExactly(event);
  }

  @Test
  void rejectsAnInvalidWindowBeforeCallingTheService() {
    assertThatThrownBy(
            () ->
                controller.search(null, Instant.parse("2026-11-15T10:00:00Z"), Instant.EPOCH, null))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(400));
  }

  @Test
  void requiresAuthentication() {
    TenantContext.clear();

    assertThatThrownBy(() -> controller.search(null, null, null, null))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(401));
  }

  @Test
  void reportsOpenSearchOutageAs503() {
    when(service.search(eq(TENANT), any(LogSearchQuery.class)))
        .thenReturn(LogSearchResult.unavailable());

    assertThatThrownBy(() -> controller.search(null, null, null, null))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(503));
  }
}

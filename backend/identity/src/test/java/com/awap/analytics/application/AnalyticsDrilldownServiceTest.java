package com.awap.analytics.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.analytics.domain.AnalyticsEventSample;
import com.awap.analytics.domain.AnalyticsEventType;
import com.awap.analytics.infrastructure.AnalyticsEventSampleRepository;
import com.awap.common.api.AwapException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

class AnalyticsDrilldownServiceTest {

  private AnalyticsEventSampleRepository repository;
  private AnalyticsDrilldownService service;
  private final UUID tenantId = UUID.randomUUID();

  @BeforeEach
  void setUp() {
    repository = mock(AnalyticsEventSampleRepository.class);
    service = new AnalyticsDrilldownService(repository);
  }

  @Test
  void returnsAPageForAFilteredEventType() {
    AnalyticsEventSample sample =
        AnalyticsEventSample.of(
            tenantId,
            AnalyticsEventType.WORKFLOW_COMPLETED,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "approval",
            1200,
            Instant.parse("2026-11-03T10:00:00Z"));
    when(repository.findByTenantIdAndEventTypeAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(
            eq(tenantId), eq("WORKFLOW_COMPLETED"), any(), any(), any(Pageable.class)))
        .thenAnswer(
            invocation ->
                new PageImpl<>(List.of(sample), invocation.getArgument(4, Pageable.class), 1));

    AnalyticsDrilldown drilldown =
        service.drilldown(
            tenantId,
            LocalDate.of(2026, 11, 1),
            LocalDate.of(2026, 11, 7),
            "workflow_completed",
            0,
            20);

    assertThat(drilldown.partial()).isFalse();
    assertThat(drilldown.eventType()).isEqualTo("WORKFLOW_COMPLETED");
    assertThat(drilldown.totalElements()).isEqualTo(1);
    assertThat(drilldown.rows()).hasSize(1);
    assertThat(drilldown.rows().get(0).nodeId()).isEqualTo("approval");
  }

  @Test
  void returnsAllEventTypesWhenNoFilterIsSupplied() {
    when(repository.findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(
            eq(tenantId), any(), any(), any(Pageable.class)))
        .thenAnswer(
            invocation ->
                new PageImpl<AnalyticsEventSample>(List.of(), invocation.getArgument(3), 0));

    AnalyticsDrilldown drilldown =
        service.drilldown(
            tenantId, LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 7), " ", 0, 20);

    assertThat(drilldown.eventType()).isNull();
    assertThat(drilldown.rows()).isEmpty();
  }

  @Test
  void reportsAPartialStateWhenTheRawEventSourceFails() {
    when(repository.findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(
            eq(tenantId), any(), any(), any(Pageable.class)))
        .thenThrow(new DataAccessResourceFailureException("sample store down"));

    AnalyticsDrilldown drilldown =
        service.drilldown(
            tenantId, LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 7), null, 0, 20);

    assertThat(drilldown.partial()).isTrue();
    assertThat(drilldown.detail()).contains("unavailable");
    assertThat(drilldown.rows()).isEmpty();
  }

  @Test
  void rejectsInvalidPaging() {
    assertThatThrownBy(
            () ->
                service.drilldown(
                    tenantId, LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 7), null, -1, 20))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("page");
    assertThatThrownBy(
            () ->
                service.drilldown(
                    tenantId, LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 7), null, 0, 0))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("size");
    assertThatThrownBy(
            () ->
                service.drilldown(
                    tenantId,
                    LocalDate.of(2026, 11, 1),
                    LocalDate.of(2026, 11, 7),
                    null,
                    0,
                    AnalyticsDrilldownService.MAX_PAGE_SIZE + 1))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void reusesTheDashboardRangeValidation() {
    assertThatThrownBy(
            () ->
                service.drilldown(
                    tenantId, LocalDate.of(2026, 11, 7), LocalDate.of(2026, 11, 1), null, 0, 20))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("from must not be after to");
  }
}

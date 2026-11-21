package com.awap.analytics.interfaces.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.analytics.application.AnalyticsDashboard;
import com.awap.analytics.application.AnalyticsDashboardQuery;
import com.awap.analytics.application.AnalyticsDrilldown;
import com.awap.analytics.application.AnalyticsDrilldownService;
import com.awap.analytics.application.AnalyticsOverview;
import com.awap.analytics.application.AnalyticsOverviewService;
import com.awap.identity.IdentityApplication;
import com.awap.identity.infrastructure.security.TenantContext;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest(classes = IdentityApplication.class)
class AnalyticsConsoleControllerWebMvcTest {

  @Autowired private WebApplicationContext context;
  @MockitoBean private AnalyticsOverviewService overviewService;
  @MockitoBean private AnalyticsDrilldownService drilldownService;

  private MockMvc mockMvc;
  private UUID tenantId;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    tenantId = UUID.randomUUID();
    TenantContext.set(tenantId, UUID.randomUUID(), "EMPLOYEE");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private static AnalyticsOverview overview() {
    AnalyticsDashboard dashboard =
        new AnalyticsDashboard(
            LocalDate.of(2026, 11, 2),
            LocalDate.of(2026, 11, 8),
            "DAY",
            "UTC",
            new AnalyticsDashboard.DataCompleteness(true, true, 1),
            List.of(
                new AnalyticsDashboard.DailyTotal(
                    LocalDate.of(2026, 11, 2), "WORKFLOW_COMPLETED", 2, 4000, 2000)),
            List.of(),
            AnalyticsDashboard.PercentileSet.empty(),
            AnalyticsDashboard.PercentileSet.empty(),
            AnalyticsDashboard.PercentileSet.empty(),
            0.1,
            0.05,
            List.of(),
            List.of(),
            new AnalyticsDashboard.Trend(2, 1, 1));
    return AnalyticsOverview.of(dashboard);
  }

  @Test
  void overviewReturnsTheSingleMetricProjection() throws Exception {
    when(overviewService.overview(eq(tenantId), any(AnalyticsDashboardQuery.class)))
        .thenReturn(overview());

    mockMvc
        .perform(
            get("/api/v1/analytics/overview")
                .with(user("u").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalEvents").value(2))
        .andExpect(jsonPath("$.eventTotals[0].eventType").value("WORKFLOW_COMPLETED"));
  }

  @Test
  void drilldownReturnsRows() throws Exception {
    when(drilldownService.drilldown(
            eq(tenantId), any(), any(), eq("TASK_COMPLETED"), eq(0), eq(20)))
        .thenReturn(
            new AnalyticsDrilldown(
                LocalDate.of(2026, 11, 2),
                LocalDate.of(2026, 11, 8),
                "TASK_COMPLETED",
                0,
                20,
                1,
                1,
                false,
                null,
                List.of(
                    new AnalyticsDrilldown.Row(
                        UUID.randomUUID(),
                        "TASK_COMPLETED",
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        "approval",
                        1200,
                        Instant.parse("2026-11-03T10:00:00Z")))));

    mockMvc
        .perform(
            get("/api/v1/analytics/drilldown")
                .param("eventType", "TASK_COMPLETED")
                .with(user("u").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.rows[0].nodeId").value("approval"))
        .andExpect(jsonPath("$.partial").value(false));
  }

  @Test
  void exportReturnsCsv() throws Exception {
    when(overviewService.overview(eq(tenantId), any(AnalyticsDashboardQuery.class)))
        .thenReturn(overview());

    mockMvc
        .perform(
            get("/api/v1/analytics/export")
                .with(user("u").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(
            header().string("Content-Disposition", "attachment; filename=\"awap-analytics.csv\""))
        .andExpect(header().string("X-AWAP-Export-Rows", "1"));
  }

  @Test
  void reversedRangesAreRejectedBeforeTheServiceIsCalled() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/analytics/overview")
                .param("from", "2026-11-08")
                .param("to", "2026-11-02")
                .with(user("u").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isBadRequest());

    TenantContext.set(tenantId, UUID.randomUUID(), "EMPLOYEE");
    mockMvc
        .perform(
            get("/api/v1/analytics/export")
                .param("from", "2026-11-08")
                .param("to", "2026-11-02")
                .with(user("u").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void requiresTheReadAuthority() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/analytics/overview")
                .with(user("u").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isForbidden());
    mockMvc.perform(get("/api/v1/analytics/overview")).andExpect(status().isUnauthorized());
  }

  @Test
  void anAuthenticatedCallWithoutATenantContextIsUnauthorized() throws Exception {
    TenantContext.clear();
    mockMvc
        .perform(
            get("/api/v1/analytics/overview")
                .with(user("u").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isUnauthorized());
  }
}

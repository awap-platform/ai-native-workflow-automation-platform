package com.awap.identity.interfaces.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.identity.IdentityApplication;
import com.awap.identity.application.AdminConsoleService;
import com.awap.identity.application.BreakGlassLogService;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.identity.interfaces.dto.AdminAuditPageResponse;
import com.awap.identity.interfaces.dto.AdminDlqDelivery;
import com.awap.identity.interfaces.dto.AdminDlqRetryResponse;
import com.awap.identity.interfaces.dto.AdminIdentityResponse;
import com.awap.identity.interfaces.dto.AdminInvitationCreated;
import com.awap.identity.interfaces.dto.AdminOperateResponse;
import com.awap.identity.interfaces.dto.BreakGlassLogResponse;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest(classes = IdentityApplication.class)
class AdminConsoleControllerWebMvcTest {

  @Autowired private WebApplicationContext context;
  @MockitoBean private AdminConsoleService adminConsoleService;
  @MockitoBean private BreakGlassLogService breakGlassLogService;

  private MockMvc mockMvc;
  private UUID tenantId;
  private UUID userId;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    tenantId = UUID.randomUUID();
    userId = UUID.randomUUID();
    TenantContext.set(tenantId, UUID.randomUUID(), "TENANT_ADMIN");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private static AdminIdentityResponse identity() {
    return new AdminIdentityResponse(
        UUID.randomUUID(),
        "FREE",
        10,
        5,
        1000,
        2,
        1,
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        List.of());
  }

  private static AdminOperateResponse operate() {
    return new AdminOperateResponse(
        UUID.randomUUID(),
        Instant.now(),
        new AdminOperateResponse.WorkflowHealth(1, 1, 0),
        new AdminOperateResponse.InstanceHealth(2, 1, 0, 1),
        new AdminOperateResponse.TaskHealth(3, 2, 1),
        new AdminOperateResponse.OutboxHealth(0, 0),
        new AdminOperateResponse.DlqHealth(0),
        List.of(new AdminOperateResponse.JobHealth("outbox-relay", "UP", "last run: now")));
  }

  @Test
  void identityReturnsTheAdministrationProjection() throws Exception {
    when(adminConsoleService.identity(eq(tenantId), eq(tenantId), eq("TENANT_ADMIN")))
        .thenReturn(identity());

    mockMvc
        .perform(
            get("/api/v1/admin/identity")
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.plan").value("FREE"))
        .andExpect(jsonPath("$.maxUsers").value(10));
  }

  @Test
  void identityUsesAnExplicitTenantParameter() throws Exception {
    UUID requested = UUID.randomUUID();
    when(adminConsoleService.identity(eq(requested), eq(tenantId), eq("TENANT_ADMIN")))
        .thenReturn(identity());

    mockMvc
        .perform(
            get("/api/v1/admin/identity")
                .param("tenantId", requested.toString())
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isOk());
  }

  @Test
  void operateReturnsHealthCards() throws Exception {
    when(adminConsoleService.operate(any(), any(), any())).thenReturn(operate());

    mockMvc
        .perform(
            get("/api/v1/admin/operate")
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.workflows.total").value(1))
        .andExpect(jsonPath("$.jobs[0].status").value("UP"));
  }

  @Test
  void auditReturnsAPage() throws Exception {
    AdminAuditPageResponse page =
        new AdminAuditPageResponse(
            List.of(
                new AdminAuditPageResponse.AuditEntry(
                    UUID.randomUUID(),
                    "USER",
                    UUID.randomUUID(),
                    "ROLE_CHANGED",
                    "EMPLOYEE",
                    "MANAGER",
                    UUID.randomUUID(),
                    Instant.now())),
            "cursor-1",
            true);
    when(adminConsoleService.audit(eq(tenantId), eq(tenantId), eq("TENANT_ADMIN"), eq("c"), eq(5)))
        .thenReturn(page);

    mockMvc
        .perform(
            get("/api/v1/admin/audit")
                .param("cursor", "c")
                .param("limit", "5")
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].action").value("ROLE_CHANGED"))
        .andExpect(jsonPath("$.nextCursor").value("cursor-1"))
        .andExpect(jsonPath("$.hasMore").value(true));
  }

  @Test
  void auditExportSetsCsvHeaders() throws Exception {
    when(adminConsoleService.exportAudit(any(), any(), any(), any(), any()))
        .thenReturn(
            new AdminConsoleService.AuditExport(
                "createdAt,action\n2026-11-21,ROLE_CHANGED\n".getBytes(), false));

    mockMvc
        .perform(
            get("/api/v1/admin/audit/export")
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(
            header().string("Content-Disposition", "attachment; filename=\"awap-audit.csv\""))
        .andExpect(header().string("X-AWAP-Export-Truncated", "false"));
  }

  @Test
  void changeRoleReturnsTheUpdatedUser() throws Exception {
    AdminIdentityResponse.AdminUser updated =
        new AdminIdentityResponse.AdminUser(
            userId, "a@b.test", "A", "MANAGER", false, Instant.now());
    when(adminConsoleService.changeRole(any(), any(), any(), any(), eq(userId), eq("MANAGER")))
        .thenReturn(updated);

    mockMvc
        .perform(
            put("/api/v1/admin/users/" + userId + "/role")
                .with(csrf())
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"MANAGER\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("MANAGER"));
  }

  @Test
  void changeRoleValidatesTheBody() throws Exception {
    mockMvc
        .perform(
            put("/api/v1/admin/users/" + userId + "/role")
                .with(csrf())
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"\"}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void deleteUserReturnsNoContent() throws Exception {
    mockMvc
        .perform(
            delete("/api/v1/admin/users/" + userId)
                .with(csrf())
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isNoContent());
  }

  @Test
  void inviteReturnsCreated() throws Exception {
    when(adminConsoleService.invite(
            any(), any(), any(), any(), eq("new@acme.test"), eq("EMPLOYEE")))
        .thenReturn(
            new AdminInvitationCreated(
                UUID.randomUUID(), "new@acme.test", "EMPLOYEE", Instant.now(), "token"));
    mockMvc
        .perform(
            post("/api/v1/admin/invitations")
                .with(csrf())
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"new@acme.test\",\"role\":\"EMPLOYEE\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.token").value("token"));
  }

  @Test
  void inviteValidatesTheEmail() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/admin/invitations")
                .with(csrf())
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"not-an-email\",\"role\":\"EMPLOYEE\"}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void dlqListsFailedDeliveries() throws Exception {
    when(adminConsoleService.dlq(any(), any(), any()))
        .thenReturn(
            List.of(
                new AdminDlqDelivery(
                    UUID.randomUUID(),
                    "EMAIL",
                    "ada@acme.test",
                    "task.assigned",
                    3,
                    "smtp",
                    Instant.now())));
    mockMvc
        .perform(
            get("/api/v1/admin/dlq")
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].recipient").value("ada@acme.test"));
  }

  @Test
  void retryDlqReturnsTheResult() throws Exception {
    UUID deliveryId = UUID.randomUUID();
    when(adminConsoleService.retryDlq(any(), any(), any(), any(), eq(deliveryId)))
        .thenReturn(new AdminDlqRetryResponse(deliveryId, "RETRYING", 0, "re-queued"));
    mockMvc
        .perform(
            post("/api/v1/admin/dlq/" + deliveryId + "/retry")
                .with(csrf())
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("RETRYING"));
  }

  @Test
  void breakGlassReturnsTheCommittedLog() throws Exception {
    when(breakGlassLogService.read())
        .thenReturn(new BreakGlassLogResponse(true, JsonNodeFactory.instance.objectNode()));
    mockMvc
        .perform(
            get("/api/v1/admin/break-glass")
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.available").value(true));
  }

  @Test
  void everyEndpointRequiresTheUserManageAuthority() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/admin/identity")
                .with(user("employee").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isForbidden());
    mockMvc
        .perform(get("/api/v1/admin/identity").with(user("anonymous").authorities(List.of())))
        .andExpect(status().isForbidden());
    mockMvc.perform(get("/api/v1/admin/identity")).andExpect(status().isUnauthorized());
  }

  @Test
  void anAuthenticatedCallWithoutATenantContextIsUnauthorized() throws Exception {
    TenantContext.clear();
    mockMvc
        .perform(
            get("/api/v1/admin/identity")
                .with(user("admin").authorities(new SimpleGrantedAuthority("USER_MANAGE"))))
        .andExpect(status().isUnauthorized());
  }
}

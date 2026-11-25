package com.awap.ai.interfaces.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.ai.application.CopilotSessionService;
import com.awap.identity.IdentityApplication;
import com.awap.identity.infrastructure.security.TenantContext;
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
class CopilotSessionControllerWebMvcTest {

  private static final UUID TENANT = UUID.fromString("44444444-4444-4444-4444-444444444444");
  private static final UUID USER = UUID.fromString("55555555-5555-5555-5555-555555555555");

  @Autowired private WebApplicationContext context;
  @MockitoBean private CopilotSessionService service;

  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    TenantContext.set(TENANT, USER, "MANAGER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private CopilotSessionService.SessionView sessionView(UUID id) {
    Instant now = Instant.parse("2026-11-25T00:00:00Z");
    return new CopilotSessionService.SessionView(id, "Quarterly review", now, now, false);
  }

  @Test
  void createReturns201WithTheSession() throws Exception {
    UUID id = UUID.randomUUID();
    when(service.create(TENANT, USER, "Quarterly review")).thenReturn(sessionView(id));

    mockMvc
        .perform(
            post("/api/v1/copilot/sessions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Quarterly review\"}")
                .with(csrf())
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(id.toString()))
        .andExpect(jsonPath("$.title").value("Quarterly review"));
  }

  @Test
  void listReturnsAPage() throws Exception {
    UUID id = UUID.randomUUID();
    when(service.list(TENANT, 0, 20))
        .thenReturn(new CopilotSessionService.SessionPage(List.of(sessionView(id)), 0, 20, 1));

    mockMvc
        .perform(
            get("/api/v1/copilot/sessions")
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].id").value(id.toString()))
        .andExpect(jsonPath("$.total").value(1));
  }

  @Test
  void getReturnsTheThreadWithTurnsAndApprovals() throws Exception {
    UUID id = UUID.randomUUID();
    Instant now = Instant.parse("2026-11-25T00:00:00Z");
    when(service.get(TENANT, id))
        .thenReturn(
            new CopilotSessionService.ThreadView(
                id,
                "Quarterly review",
                now,
                now,
                false,
                now,
                List.of(
                    new CopilotSessionService.TurnView(
                        UUID.randomUUID(),
                        1,
                        "user",
                        "hello",
                        "a".repeat(64),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        now)),
                List.of()));

    mockMvc
        .perform(
            get("/api/v1/copilot/sessions/" + id)
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.turns[0].content").value("hello"));
  }

  @Test
  void appendTurnForwardsTheIdempotencyKey() throws Exception {
    UUID id = UUID.randomUUID();
    Instant now = Instant.parse("2026-11-25T00:00:00Z");
    when(service.appendTurn(
            eq(TENANT), eq(id), eq("user"), eq("hello"), eq("key-1"), any(), any(), any(), any()))
        .thenReturn(
            new CopilotSessionService.TurnView(
                UUID.randomUUID(),
                1,
                "user",
                "hello",
                "a".repeat(64),
                null,
                null,
                null,
                null,
                null,
                "key-1",
                now));

    mockMvc
        .perform(
            post("/api/v1/copilot/sessions/" + id + "/turns")
                .header("Idempotency-Key", "key-1")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"user\",\"content\":\"hello\"}")
                .with(csrf())
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.idempotencyKey").value("key-1"));
  }

  @Test
  void openHitlReturnsThePendingApproval() throws Exception {
    UUID id = UUID.randomUUID();
    Instant now = Instant.parse("2026-11-25T00:00:00Z");
    when(service.openHitl(TENANT, id, null, "Approve the expense", "{}"))
        .thenReturn(
            new CopilotSessionService.HitlView(
                UUID.randomUUID(),
                id,
                null,
                "PENDING",
                "Approve the expense",
                "{}",
                null,
                null,
                now));

    mockMvc
        .perform(
            post("/api/v1/copilot/sessions/" + id + "/hitl")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"summary\":\"Approve the expense\",\"proposalJson\":\"{}\"}")
                .with(csrf())
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.state").value("PENDING"));
  }

  @Test
  void decideHitlScopesTheDecisionToTheSession() throws Exception {
    UUID id = UUID.randomUUID();
    UUID hitlId = UUID.randomUUID();
    Instant now = Instant.parse("2026-11-25T00:00:00Z");
    when(service.decideHitl(TENANT, hitlId, "APPROVED", USER))
        .thenReturn(
            new CopilotSessionService.HitlView(
                hitlId, id, null, "APPROVED", "Approve", "{}", USER, now, now));

    mockMvc
        .perform(
            post("/api/v1/copilot/sessions/" + id + "/hitl/" + hitlId + "/decision")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"APPROVED\"}")
                .with(csrf())
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("APPROVED"));

    verify(service).get(TENANT, id);
  }

  @Test
  void exportReturnsEveryTurn() throws Exception {
    UUID id = UUID.randomUUID();
    Instant now = Instant.parse("2026-11-25T00:00:00Z");
    when(service.export(TENANT, id, USER))
        .thenReturn(
            new CopilotSessionService.ExportView(id, "Review", now, now, List.of(), List.of()));

    mockMvc
        .perform(
            get("/api/v1/copilot/sessions/" + id + "/export")
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("Review"));
  }

  @Test
  void archiveReturnsNoContent() throws Exception {
    UUID id = UUID.randomUUID();

    mockMvc
        .perform(
            delete("/api/v1/copilot/sessions/" + id)
                .with(csrf())
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isNoContent());

    verify(service).archive(TENANT, id);
  }

  @Test
  void listWithoutAuthenticationReturns401() throws Exception {
    TenantContext.clear();

    mockMvc
        .perform(
            get("/api/v1/copilot/sessions")
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void createWithoutAuthenticationReturns401() throws Exception {
    TenantContext.clear();

    mockMvc
        .perform(
            post("/api/v1/copilot/sessions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Review\"}")
                .with(csrf())
                .with(user("manager").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isUnauthorized());
  }
}

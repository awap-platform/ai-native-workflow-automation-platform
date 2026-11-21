package com.awap.notification.interfaces.api;

import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.identity.IdentityApplication;
import com.awap.identity.infrastructure.security.TenantContext;
import com.awap.notification.application.NotificationSuppressionService;
import com.awap.notification.domain.NotificationChannel;
import com.awap.notification.domain.NotificationSuppression;
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
class NotificationSuppressionControllerWebMvcTest {

  @Autowired private WebApplicationContext context;
  @MockitoBean private NotificationSuppressionService service;

  private MockMvc mockMvc;
  private UUID tenantId;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    tenantId = UUID.randomUUID();
    TenantContext.set(tenantId, UUID.randomUUID(), "SUPPORT");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void listsSuppressedRecipientsForTheTenant() throws Exception {
    NotificationSuppression suppression =
        new NotificationSuppression(
            tenantId, NotificationChannel.EMAIL, "ada@example.com", "SMTP_BOUNCE");
    when(service.list(tenantId)).thenReturn(List.of(suppression));

    mockMvc
        .perform(
            get("/api/v1/notifications/suppressions")
                .with(user("u").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].channel").value("EMAIL"))
        .andExpect(jsonPath("$[0].recipient").value("ada@example.com"))
        .andExpect(jsonPath("$[0].reason").value("SMTP_BOUNCE"))
        .andExpect(jsonPath("$[0].createdAt").exists());
  }

  @Test
  void requiresTheReadAuthority() throws Exception {
    mockMvc
        .perform(
            get("/api/v1/notifications/suppressions")
                .with(user("u").authorities(new SimpleGrantedAuthority("ROLE_EMPLOYEE"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void requiresAuthentication() throws Exception {
    mockMvc.perform(get("/api/v1/notifications/suppressions")).andExpect(status().isUnauthorized());
  }
}

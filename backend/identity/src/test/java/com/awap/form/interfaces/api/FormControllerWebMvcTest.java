package com.awap.form.interfaces.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.form.application.FormService;
import com.awap.form.interfaces.dto.FormSchemaVersionResponse;
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
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest(classes = IdentityApplication.class)
class FormControllerWebMvcTest {

  @Autowired private WebApplicationContext context;
  @MockitoBean private FormService formService;

  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    TenantContext.set(UUID.randomUUID(), UUID.randomUUID(), "MANAGER");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void versionReturnsTheImmutableSnapshot() throws Exception {
    UUID formId = UUID.randomUUID();
    when(formService.getVersion(any(UUID.class), eq(formId), eq(2)))
        .thenReturn(
            new FormSchemaVersionResponse(
                UUID.randomUUID(),
                formId,
                2,
                "{\"fields\":[{\"id\":\"name\",\"type\":\"TEXT\"}]}",
                "a".repeat(64),
                Instant.parse("2026-01-01T00:00:00Z")));

    mockMvc
        .perform(
            get("/api/v1/forms/{id}/versions/{version}", formId, 2)
                .with(user("u").authorities(new SimpleGrantedAuthority("FORM_MANAGE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(2))
        .andExpect(jsonPath("$.schemaHash").value("a".repeat(64)));
  }

  @Test
  void listRequiresFormManage() throws Exception {
    when(formService.list(any(UUID.class))).thenReturn(List.of());
    mockMvc
        .perform(
            get("/api/v1/forms")
                .with(user("u").authorities(new SimpleGrantedAuthority("FORM_MANAGE"))))
        .andExpect(status().isOk());
  }

  @Test
  void listUnauthenticatedReturns401() throws Exception {
    mockMvc.perform(get("/api/v1/forms")).andExpect(status().isUnauthorized());
  }
}

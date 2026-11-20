package com.awap.workflow.interfaces.api;

import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.identity.IdentityApplication;
import com.awap.identity.infrastructure.security.TenantContext;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringBootTest(classes = IdentityApplication.class)
class WorkflowBpmnControllerWebMvcTest {

  private static final String START_END_BPMN =
      """
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
        <bpmn:process id="p">
          <bpmn:startEvent id="start" name="Start"/>
          <bpmn:endEvent id="end" name="Done"/>
          <bpmn:sequenceFlow id="t1" sourceRef="start" targetRef="end"/>
        </bpmn:process>
      </bpmn:definitions>
      """;

  @Autowired private WebApplicationContext context;

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
  void importReturnsTheDefinitionJson() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/workflow-definitions/bpmn/import")
                .with(csrf())
                .contentType(APPLICATION_JSON)
                .content(json("bpmnXml", START_END_BPMN))
                .with(user("u").authorities(new SimpleGrantedAuthority("WORKFLOW_CREATE"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.warnings").isArray())
        .andExpect(
            jsonPath("$.definitionJson").value(org.hamcrest.Matchers.containsString("\"START\"")));
  }

  @Test
  void importRejectsInvalidBpmnWithALineReference() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/workflow-definitions/bpmn/import")
                .with(csrf())
                .contentType(APPLICATION_JSON)
                .content(json("bpmnXml", "<bpmn:definitions>"))
                .with(user("u").authorities(new SimpleGrantedAuthority("WORKFLOW_CREATE"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("line")));
  }

  @Test
  void importRejectsOversizedXmlWith413() throws Exception {
    String oversized = "a".repeat(1_000_001);
    mockMvc
        .perform(
            post("/api/v1/workflow-definitions/bpmn/import")
                .with(csrf())
                .contentType(APPLICATION_JSON)
                .content(json("bpmnXml", oversized))
                .with(user("u").authorities(new SimpleGrantedAuthority("WORKFLOW_CREATE"))))
        .andExpect(status().isPayloadTooLarge());
  }

  @Test
  void exportReturnsBpmnXml() throws Exception {
    String definition = "{\"nodes\":[{\"id\":\"s\",\"type\":\"START\"}]}";
    mockMvc
        .perform(
            post("/api/v1/workflow-definitions/bpmn/export")
                .with(csrf())
                .contentType(APPLICATION_JSON)
                .content(json("definitionJson", definition))
                .with(user("u").authorities(new SimpleGrantedAuthority("WORKFLOW_CREATE"))))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.bpmnXml").value(org.hamcrest.Matchers.containsString("bpmn:startEvent")));
  }

  @Test
  void importRequiresWorkflowCreate() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/workflow-definitions/bpmn/import")
                .with(csrf())
                .contentType(APPLICATION_JSON)
                .content(json("bpmnXml", START_END_BPMN))
                .with(user("u").authorities(new SimpleGrantedAuthority("INSTANCE_READ"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void importRequiresAuthentication() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/workflow-definitions/bpmn/import")
                .with(csrf())
                .contentType(APPLICATION_JSON)
                .content(json("bpmnXml", START_END_BPMN)))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void importRejectsABlankBodyField() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/workflow-definitions/bpmn/import")
                .with(csrf())
                .contentType(APPLICATION_JSON)
                .content("{\"bpmnXml\":\" \"}")
                .with(user("u").authorities(new SimpleGrantedAuthority("WORKFLOW_CREATE"))))
        .andExpect(status().isBadRequest());
  }

  private String json(String field, String value) {
    return "{\""
        + field
        + "\":\""
        + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "").replace("\n", "\\n")
        + "\"}";
  }
}

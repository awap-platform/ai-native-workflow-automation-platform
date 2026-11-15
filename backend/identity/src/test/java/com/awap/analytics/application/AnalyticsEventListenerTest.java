package com.awap.analytics.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.awap.analytics.domain.AnalyticsEventType;
import com.awap.common.api.AwapException;
import com.awap.identity.infrastructure.security.KafkaTenantContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AnalyticsEventListenerTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private final AnalyticsService analyticsService = mock(AnalyticsService.class);
  private final KafkaTenantContext tenantContext = mock(KafkaTenantContext.class);
  private final AnalyticsEventListener listener =
      new AnalyticsEventListener(objectMapper, analyticsService, tenantContext);

  @BeforeEach
  void runInsideTheTenantContext() {
    doAnswer(
            invocation -> {
              Runnable action = invocation.getArgument(1);
              action.run();
              return null;
            })
        .when(tenantContext)
        .run(any(), any());
  }

  @Test
  void forwardsTheNodeIdAndDurationToTheAnalyticsService() {
    UUID tenant = UUID.randomUUID();

    listener.onMessage(
        "{\"tenantId\":\""
            + tenant
            + "\",\"eventType\":\"TASK_COMPLETED\",\"workflowInstanceId\":null,"
            + "\"taskId\":null,\"nodeId\":\"approval\",\"durationMs\":250}");

    verify(analyticsService)
        .record(
            eq(tenant),
            eq(AnalyticsEventType.TASK_COMPLETED),
            isNull(),
            isNull(),
            eq("approval"),
            eq(250L));
  }

  @Test
  void treatsANullNodeIdAsAbsent() {
    UUID tenant = UUID.randomUUID();

    listener.onMessage(
        "{\"tenantId\":\""
            + tenant
            + "\",\"eventType\":\"WORKFLOW_FAILED\",\"workflowInstanceId\":null,"
            + "\"taskId\":null,\"nodeId\":null,\"durationMs\":null}");

    verify(analyticsService)
        .record(
            eq(tenant),
            eq(AnalyticsEventType.WORKFLOW_FAILED),
            isNull(),
            isNull(),
            isNull(),
            eq(0L));
  }

  @Test
  void rejectsAMalformedPayloadWithA400() {
    assertThatThrownBy(() -> listener.onMessage("{\"tenantId\":\"not-a-uuid\"}"))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(400));
  }
}

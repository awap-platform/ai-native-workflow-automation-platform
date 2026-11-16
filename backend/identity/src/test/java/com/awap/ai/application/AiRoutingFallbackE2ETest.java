package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.awap.ai.domain.AiModelRouter;
import com.awap.ai.domain.AutomationAudit;
import com.awap.ai.infrastructure.AutomationAuditRepository;
import com.awap.common.api.AwapException;
import com.awap.usage.application.UsageMeteringService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * End-to-end routing + cost + fallback test through the real AI node path (issue #307).
 *
 * <p>The node uses the real {@link AiAgentService} + {@link AiProviderGateway}; only the provider
 * adapters are deterministic recording fakes.
 */
class AiRoutingFallbackE2ETest {

  private final UUID tenantId = UUID.randomUUID();
  private final UUID instanceId = UUID.randomUUID();
  private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
  private final AutomationAuditRepository auditRepository = mock(AutomationAuditRepository.class);

  @Test
  void simpleRequestUsesTheCheapModelAndRecordsCost() {
    FakeProvider provider = provider("primary");
    AiNodeService service = node(List.of(provider), "primary", "primary", 1_000_000);

    AiNodeService.AiNodeResult result =
        service.evaluate(
            tenantId, instanceId, "ai-1", AiNodeService.AiAction.SUMMARIZE, "short input");

    assertThat(result.confidence()).isGreaterThan(0.7);
    assertThat(provider.modelsRequested()).containsExactly("cheap-model");
    assertThat(registry.get("awap.ai.tokens").counter().count()).isPositive();
    assertThat(registry.get("awap.ai.cost.micros").counter().count()).isPositive();
    assertThat(lastAudit().getTenantId()).isEqualTo(tenantId);
    assertThat(lastAudit().getModel()).isEqualTo("cheap-model");
  }

  @Test
  void complexRequestUsesTheComplexModel() {
    FakeProvider provider = provider("primary");
    AiNodeService service = node(List.of(provider), "primary", "primary", 1_000_000);

    service.evaluate(
        tenantId,
        instanceId,
        "ai-1",
        AiNodeService.AiAction.SUMMARIZE,
        "compare multiple approval steps and then plan the document workflow end to end");

    assertThat(provider.modelsRequested()).containsExactly("complex-model");
    assertThat(lastAudit().getModel()).isEqualTo("complex-model");
  }

  @Test
  void aPrimary429FallsBackToTheSecondaryAndIsAudited() {
    FakeProvider primary = provider("primary").fail(AiProviderException.Code.RATE_LIMITED, true);
    FakeProvider secondary = provider("secondary");
    AiNodeService service =
        node(List.of(primary, secondary), "primary", "primary,secondary", 1_000_000);

    AiNodeService.AiNodeResult result =
        service.evaluate(
            tenantId, instanceId, "ai-1", AiNodeService.AiAction.SUMMARIZE, "short input");

    assertThat(result.output()).isEqualTo("a sufficiently long and substantive answer");
    assertThat(primary.modelsRequested()).hasSize(1);
    assertThat(secondary.modelsRequested()).hasSize(1);
    assertThat(registry.get("awap.ai.gateway.fallbacks").counter().count()).isPositive();
    assertThat(lastAudit().getOutcome()).isEqualTo("SUCCESS");
  }

  @Test
  void aPrimary5xxAndTimeoutAlsoFallBack() {
    FakeProvider timeout = provider("primary").fail(AiProviderException.Code.TIMEOUT, true);
    FakeProvider secondary = provider("secondary");
    AiNodeService service =
        node(List.of(timeout, secondary), "primary", "primary,secondary", 1_000_000);

    service.evaluate(tenantId, instanceId, "ai-1", AiNodeService.AiAction.CLASSIFY, "short input");

    assertThat(secondary.modelsRequested()).hasSize(1);
  }

  @Test
  void allProvidersFailingReturnsATypedError() {
    FakeProvider primary = provider("primary").fail(AiProviderException.Code.UNAVAILABLE, true);
    AiNodeService service = node(List.of(primary), "primary", "primary", 1_000_000);

    assertThatThrownBy(
            () ->
                service.evaluate(
                    tenantId, instanceId, "ai-1", AiNodeService.AiAction.SUMMARIZE, "short input"))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(502));
  }

  @Test
  void anExhaustedBudgetReturns429BeforeAnyProviderCall() {
    FakeProvider provider = provider("primary");
    AiNodeService service = node(List.of(provider), "primary", "primary", 1);

    assertThatThrownBy(
            () ->
                service.evaluate(
                    tenantId,
                    instanceId,
                    "ai-1",
                    AiNodeService.AiAction.SUMMARIZE,
                    "a prompt long enough to exceed a one-token budget"))
        .isInstanceOf(AwapException.class)
        .satisfies(ex -> assertThat(((AwapException) ex).status().value()).isEqualTo(429));
    assertThat(provider.requests).isEmpty();
    assertThat(registry.get("awap.ai.requests").tag("outcome", "budget_exceeded").counter().count())
        .isEqualTo(1.0);
  }

  private AiNodeService node(
      List<AiProvider> providers, String primary, String fallbackOrder, long budget) {
    AiProviderGateway gateway =
        new AiProviderGateway(
            providers, primary, fallbackOrder, 0, 3, 1_000, registry, java.time.Clock.systemUTC());
    AiAgentService agentService =
        new AiAgentService(
            gateway,
            1_000,
            4_000,
            Executors.newSingleThreadExecutor(),
            mock(UsageMeteringService.class));
    return new AiNodeService(
        agentService,
        auditRepository,
        new AiBudgetGuard(budget),
        registry,
        true,
        0.7,
        2,
        "cheap-model",
        "standard-model",
        "complex-model",
        null);
  }

  private AutomationAudit lastAudit() {
    ArgumentCaptor<AutomationAudit> captor = ArgumentCaptor.forClass(AutomationAudit.class);
    org.mockito.Mockito.verify(auditRepository, org.mockito.Mockito.atLeastOnce())
        .save(captor.capture());
    return captor.getValue();
  }

  private static FakeProvider provider(String id) {
    return new FakeProvider(id);
  }

  private static final class FakeProvider implements AiProvider {
    private final String id;
    private final List<AiProviderRequest> requests = new ArrayList<>();
    private final Deque<Object> outcomes = new ArrayDeque<>();

    private FakeProvider(String id) {
      this.id = id;
    }

    FakeProvider fail(AiProviderException.Code code, boolean retryable) {
      outcomes.add(new AiProviderException(code, retryable, "boom"));
      return this;
    }

    List<String> modelsRequested() {
      return requests.stream().map(AiProviderRequest::model).toList();
    }

    @Override
    public String id() {
      return id;
    }

    @Override
    public List<AiModel> models() {
      return List.of(
          new AiModel(
              "cheap-model",
              AiModelRouter.Tier.CHEAP,
              Set.of(
                  AiCapability.TEXT_GENERATION,
                  AiCapability.SUMMARIZATION,
                  AiCapability.CLASSIFICATION,
                  AiCapability.EXTRACTION),
              1,
              5_000),
          new AiModel(
              "standard-model",
              AiModelRouter.Tier.STANDARD,
              Set.of(
                  AiCapability.TEXT_GENERATION,
                  AiCapability.SUMMARIZATION,
                  AiCapability.CLASSIFICATION,
                  AiCapability.EXTRACTION),
              2,
              5_000),
          new AiModel(
              "complex-model",
              AiModelRouter.Tier.COMPLEX,
              Set.of(
                  AiCapability.TEXT_GENERATION,
                  AiCapability.SUMMARIZATION,
                  AiCapability.CLASSIFICATION,
                  AiCapability.EXTRACTION),
              10,
              5_000));
    }

    @Override
    public boolean healthy() {
      return true;
    }

    @Override
    public String complete(AiProviderRequest request) {
      requests.add(request);
      Object outcome =
          outcomes.isEmpty() ? "a sufficiently long and substantive answer" : outcomes.remove();
      if (outcome instanceof RuntimeException failure) {
        throw failure;
      }
      return (String) outcome;
    }
  }
}

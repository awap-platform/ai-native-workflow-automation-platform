package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.awap.ai.domain.AiModelRouter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/** Gateway routing, fallback, circuit breaking and configuration validation (issue #292). */
class AiProviderGatewayTest {

  private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
  private final MutableClock clock = new MutableClock();
  private ListAppender<ILoggingEvent> appender;

  @AfterEach
  void detachLogs() {
    if (appender != null) {
      ((Logger) LoggerFactory.getLogger(AiProviderGateway.class)).detachAppender(appender);
    }
  }

  @Test
  void routesToThePrimaryProviderAndRecordsTheCapability() {
    FakeProvider primary = new FakeProvider("openai", model("gpt", 2, 5000)).then("FINANCE");
    FakeProvider local = new FakeProvider("local", model("local-heuristic", 0, 250)).then("LOCAL");
    AiProviderGateway gateway =
        gateway(List.of(primary, local), "openai", "openai,local", 0, clock);

    String result = gateway.complete("classify: invoice payment", 16);

    assertThat(result).isEqualTo("FINANCE");
    assertThat(primary.requests).hasSize(1);
    assertThat(primary.requests.get(0).capability()).isEqualTo(AiCapability.CLASSIFICATION);
    assertThat(
            registry
                .get("awap.ai.gateway.requests")
                .tags(
                    "provider",
                    "openai",
                    "model",
                    "gpt",
                    "capability",
                    "CLASSIFICATION",
                    "outcome",
                    "SUCCESS")
                .counter()
                .count())
        .isEqualTo(1.0);
  }

  @Test
  void routesByTheRequestedModel() {
    FakeProvider openai = new FakeProvider("openai", model("gpt", 2, 5000)).then("OPENAI");
    FakeProvider anthropic =
        new FakeProvider("anthropic", model("claude", 1, 5000)).then("ANTHROPIC");
    AiProviderGateway gateway =
        gateway(List.of(openai, anthropic), "openai", "openai,anthropic", 0, clock);

    assertThat(gateway.complete("hello", 8, "claude")).isEqualTo("ANTHROPIC");
    assertThat(openai.requests).isEmpty();
    assertThat(anthropic.requests).hasSize(1);
  }

  @Test
  void fallsBackOnARetryableFailureAndAuditsProviderModelAndReason() {
    appender = attachLogs();
    FakeProvider openai =
        new FakeProvider("openai", model("gpt", 2, 5000))
            .fail(AiProviderException.Code.RATE_LIMITED, true);
    FakeProvider anthropic = new FakeProvider("anthropic", model("claude", 1, 5000)).then("CLAUDE");
    AiProviderGateway gateway =
        gateway(List.of(openai, anthropic), "openai", "openai,anthropic", 0, clock);

    assertThat(gateway.complete("hello", 8)).isEqualTo("CLAUDE");
    assertThat(
            registry
                .get("awap.ai.gateway.fallbacks")
                .tags("from", "openai", "to", "anthropic", "reason", "RATE_LIMITED")
                .counter()
                .count())
        .isEqualTo(1.0);
    assertThat(appender.list)
        .anySatisfy(
            event ->
                assertThat(event.getFormattedMessage())
                    .contains("provider=openai")
                    .contains("model=gpt")
                    .contains("outcome=RATE_LIMITED")
                    .contains("fallback=anthropic"));
    assertThat(appender.list)
        .anySatisfy(
            event ->
                assertThat(event.getFormattedMessage())
                    .contains("provider=anthropic")
                    .contains("outcome=SUCCESS")
                    .contains("fallback=openai:RATE_LIMITED"));
  }

  @Test
  void fallsBackOnANonRetryableAuthenticationFailure() {
    FakeProvider openai =
        new FakeProvider("openai", model("gpt", 2, 5000))
            .fail(AiProviderException.Code.AUTHENTICATION, false);
    FakeProvider local = new FakeProvider("local", model("local", 0, 250)).then("LOCAL");
    AiProviderGateway gateway = gateway(List.of(openai, local), "openai", "openai,local", 0, clock);

    assertThat(gateway.complete("hello", 8)).isEqualTo("LOCAL");
  }

  @Test
  void allProvidersFailingReturnsATypedError() {
    FakeProvider openai =
        new FakeProvider("openai", model("gpt", 2, 5000))
            .fail(AiProviderException.Code.UNAVAILABLE, true);
    FakeProvider anthropic =
        new FakeProvider("anthropic", model("claude", 1, 5000))
            .fail(AiProviderException.Code.TIMEOUT, true);
    AiProviderGateway gateway =
        gateway(List.of(openai, anthropic), "openai", "openai,anthropic", 0, clock);

    assertThatThrownBy(() -> gateway.complete("hello", 8))
        .isInstanceOf(AiProviderException.class)
        .satisfies(
            ex ->
                assertThat(((AiProviderException) ex).code())
                    .isEqualTo(AiProviderException.Code.ALL_PROVIDERS_FAILED))
        .hasMessageContaining("openai:UNAVAILABLE")
        .hasMessageContaining("anthropic:TIMEOUT");
  }

  @Test
  void unknownModelOrCapabilityIsRejected() {
    FakeProvider local =
        new FakeProvider(
            "local",
            model("local", 0, 250, AiCapability.TEXT_GENERATION, AiCapability.SUMMARIZATION));
    AiProviderGateway gateway = gateway(List.of(local), "local", "", 0, clock);

    assertThatThrownBy(() -> gateway.complete("classify: x", 8))
        .isInstanceOf(AiProviderException.class)
        .satisfies(
            ex ->
                assertThat(((AiProviderException) ex).code())
                    .isEqualTo(AiProviderException.Code.NO_PROVIDER));
    assertThatThrownBy(() -> gateway.complete("hello", 8, "unknown-model"))
        .isInstanceOf(AiProviderException.class)
        .hasMessageContaining("unknown-model");
  }

  @Test
  void unhealthyProvidersAreSkipped() {
    FakeProvider sick = new FakeProvider("openai", List.of(model("gpt", 2, 5000)), false);
    FakeProvider healthy = new FakeProvider("local", model("local", 0, 250)).then("LOCAL");
    AiProviderGateway gateway = gateway(List.of(sick, healthy), "openai", "openai,local", 0, clock);

    assertThat(gateway.complete("hello", 8)).isEqualTo("LOCAL");
    AiProviderGateway onlySick = gateway(List.of(sick), "openai", "", 0, clock);
    assertThatThrownBy(() -> onlySick.complete("hello", 8))
        .isInstanceOf(AiProviderException.class)
        .satisfies(
            ex ->
                assertThat(((AiProviderException) ex).code())
                    .isEqualTo(AiProviderException.Code.NO_PROVIDER));
  }

  @Test
  void theBudgetSkipsExpensiveProviders() {
    FakeProvider expensive = new FakeProvider("openai", model("gpt", 10, 5000)).then("EXPENSIVE");
    FakeProvider cheap = new FakeProvider("anthropic", model("claude", 1, 5000)).then("CHEAP");
    AiProviderGateway budgeted =
        gateway(List.of(expensive, cheap), "openai", "openai,anthropic", 5, clock);

    assertThat(budgeted.complete("hello", 8)).isEqualTo("CHEAP");
    assertThat(expensive.requests).isEmpty();

    AiProviderGateway unlimited =
        gateway(List.of(expensive, cheap), "openai", "openai,anthropic", 0, clock);
    assertThat(unlimited.complete("hello", 8)).isEqualTo("EXPENSIVE");
  }

  @Test
  void aSlowProviderIsSkippedOnlyWhenAnotherProviderCanServe() {
    FakeProvider slow = new FakeProvider("openai", model("gpt", 2, 1)).sleep(20).then("SLOW");
    FakeProvider fast = new FakeProvider("anthropic", model("claude", 1, 5000)).then("FAST");
    AiProviderGateway gateway =
        gateway(List.of(slow, fast), "openai", "openai,anthropic", 0, clock);

    assertThat(gateway.complete("hello", 8)).isEqualTo("SLOW");
    assertThat(gateway.complete("hello", 8)).isEqualTo("FAST");
    FakeProvider onlySlow =
        new FakeProvider("openai", model("gpt", 2, 1)).sleep(20).then("ONLY").then("ONLY");
    AiProviderGateway single = gateway(List.of(onlySlow), "openai", "", 0, clock);
    assertThat(single.complete("hello", 8)).isEqualTo("ONLY");
    assertThat(single.complete("hello", 8)).isEqualTo("ONLY");
  }

  @Test
  void theCircuitBreakerOpensAndRecoversAfterTheWindow() {
    FakeProvider openai =
        new FakeProvider("openai", model("gpt", 2, 5000))
            .fail(AiProviderException.Code.UNAVAILABLE, true)
            .fail(AiProviderException.Code.UNAVAILABLE, true)
            .then("RECOVERED");
    FakeProvider local =
        new FakeProvider("local", model("local", 0, 250)).then("LOCAL").then("LOCAL").then("LOCAL");
    AiProviderGateway gateway =
        new AiProviderGateway(
            List.of(openai, local), "openai", "openai,local", 0, 2, 1000, registry, clock);

    assertThat(gateway.complete("hello", 8)).isEqualTo("LOCAL");
    assertThat(gateway.complete("hello", 8)).isEqualTo("LOCAL");
    assertThat(gateway.complete("hello", 8)).isEqualTo("LOCAL");
    assertThat(openai.requests).hasSize(2);

    clock.advance(1001);
    assertThat(gateway.complete("hello", 8)).isEqualTo("RECOVERED");
    assertThat(openai.requests).hasSize(3);
  }

  @Test
  void invalidConfigurationFailsFast() {
    FakeProvider provider = new FakeProvider("openai", model("gpt", 2, 5000));
    FakeProvider duplicate = new FakeProvider("openai", model("other", 2, 5000));
    FakeProvider noModels = new FakeProvider("empty", List.of(), true);

    assertThatThrownBy(() -> gateway(List.of(), "openai", "", 0, clock))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("At least one");
    assertThatThrownBy(() -> gateway(List.of(provider, duplicate), "openai", "", 0, clock))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Duplicate");
    assertThatThrownBy(() -> gateway(List.of(noModels), "empty", "", 0, clock))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("no models");
    assertThatThrownBy(() -> gateway(List.of(provider), "ghost", "", 0, clock))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Unknown primary");
    assertThatThrownBy(() -> gateway(List.of(provider), "openai", "ghost", 0, clock))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("fallback order");
    assertThatThrownBy(() -> gateway(List.of(provider), "openai", "", -1, clock))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("cost budget");
  }

  @Test
  void theSpringConstructorAndBlankFallbackAreSupported() {
    FakeProvider local =
        new FakeProvider("local", model("local", 0, 250)).then("LOCAL").then("LOCAL").then("LOCAL");
    AiProviderGateway gateway =
        new AiProviderGateway(List.of(local), "local", "", 0, 3, 1000, registry, clock);
    AiProviderGateway nullFallback =
        new AiProviderGateway(List.of(local), "local", null, 0, 3, 1000, registry, clock);

    assertThat(gateway.complete("hello", 8)).isEqualTo("LOCAL");
    assertThat(nullFallback.complete("hello", 8)).isEqualTo("LOCAL");
    assertThat(new AiProviderGateway(List.of(local), "local", "", 0, 3, 1000, registry))
        .isNotNull();
  }

  @Test
  void aBlankModelStillRoutesNormally() {
    FakeProvider local = new FakeProvider("local", model("local", 0, 250)).then("LOCAL");
    AiProviderGateway gateway = gateway(List.of(local), "local", "", 0, clock);

    assertThat(gateway.complete("hello", 8, " ")).isEqualTo("LOCAL");
  }

  @Test
  void capabilityDetectionIsDeterministic() {
    assertThat(AiProviderGateway.capabilityOf("summarize: x"))
        .isEqualTo(AiCapability.SUMMARIZATION);
    assertThat(AiProviderGateway.capabilityOf("CLASSIFY: x"))
        .isEqualTo(AiCapability.CLASSIFICATION);
    assertThat(AiProviderGateway.capabilityOf("extract: x")).isEqualTo(AiCapability.EXTRACTION);
    assertThat(AiProviderGateway.capabilityOf("hello")).isEqualTo(AiCapability.TEXT_GENERATION);
    assertThat(AiProviderGateway.capabilityOf(null)).isEqualTo(AiCapability.TEXT_GENERATION);
  }

  @Test
  void theCircuitBreakerClosesOnSuccessAndOpensAtTheThreshold() {
    CircuitBreaker breaker = new CircuitBreaker(2, 1000);

    assertThat(breaker.allow(0)).isTrue();
    breaker.recordFailure(0);
    assertThat(breaker.allow(0)).isTrue();
    assertThat(breaker.open(0)).isFalse();
    breaker.recordFailure(0);
    assertThat(breaker.allow(0)).isFalse();
    assertThat(breaker.open(0)).isTrue();
    assertThat(breaker.allow(1000)).isTrue();

    breaker.recordSuccess();
    assertThat(breaker.open(1000)).isFalse();
    assertThat(breaker.allow(1000)).isTrue();
  }

  @Test
  void aZeroThresholdStillOpensAfterOneFailure() {
    CircuitBreaker breaker = new CircuitBreaker(0, 1000);

    breaker.recordFailure(5);
    assertThat(breaker.open(5)).isTrue();
    assertThat(breaker.allow(5)).isFalse();
    assertThat(breaker.allow(1006)).isTrue();
  }

  @Test
  void modelAndRequestValuesAreValidated() {
    assertThatThrownBy(
            () ->
                new AiModel(
                    "", AiModelRouter.Tier.CHEAP, Set.of(AiCapability.TEXT_GENERATION), 1, 1))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("model id");
    assertThatThrownBy(() -> new AiModel("m", null, Set.of(AiCapability.TEXT_GENERATION), 1, 1))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("tier");
    assertThatThrownBy(() -> new AiModel("m", AiModelRouter.Tier.CHEAP, Set.of(), 1, 1))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("capabilities");
    assertThatThrownBy(() -> new AiModel("m", AiModelRouter.Tier.CHEAP, null, 1, 1))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("capabilities");
    assertThatThrownBy(
            () ->
                new AiModel(
                    "m", AiModelRouter.Tier.CHEAP, Set.of(AiCapability.TEXT_GENERATION), -1, 1))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("cost");
    assertThatThrownBy(
            () ->
                new AiModel(
                    "m", AiModelRouter.Tier.CHEAP, Set.of(AiCapability.TEXT_GENERATION), 1, 0))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("latency");

    assertThatThrownBy(() -> new AiProviderRequest("", 1, null, AiCapability.TEXT_GENERATION))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("prompt");
    assertThatThrownBy(() -> new AiProviderRequest("p", 0, null, AiCapability.TEXT_GENERATION))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("maxTokens");
    assertThatThrownBy(() -> new AiProviderRequest("p", 1, null, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("capability");
  }

  @Test
  void providerErrorsKeepTheNeutralCodeAndCause() {
    IllegalStateException cause = new IllegalStateException("root");
    AiProviderException error =
        new AiProviderException(AiProviderException.Code.TIMEOUT, true, "slow", cause);

    assertThat(error.code()).isEqualTo(AiProviderException.Code.TIMEOUT);
    assertThat(error.retryable()).isTrue();
    assertThat(error).hasCause(cause).hasMessage("slow");
  }

  private AiProviderGateway gateway(
      List<AiProvider> providers, String primary, String fallback, long budget, Clock testClock) {
    return new AiProviderGateway(
        providers, primary, fallback, budget, 2, 1000, registry, testClock);
  }

  private ListAppender<ILoggingEvent> attachLogs() {
    Logger logger = (Logger) LoggerFactory.getLogger(AiProviderGateway.class);
    ListAppender<ILoggingEvent> listAppender = new ListAppender<>();
    listAppender.start();
    logger.addAppender(listAppender);
    return listAppender;
  }

  private static AiModel model(
      String id, long costMicrosPerToken, long latencyBudgetMs, AiCapability... capabilities) {
    Set<AiCapability> supported =
        capabilities.length == 0 ? EnumSet.allOf(AiCapability.class) : Set.of(capabilities);
    return new AiModel(
        id, AiModelRouter.Tier.STANDARD, supported, costMicrosPerToken, latencyBudgetMs);
  }

  private static final class FakeProvider implements AiProvider {
    private final String id;
    private final List<AiModel> models;
    private final boolean healthy;
    private final Deque<Object> outcomes = new ArrayDeque<>();
    private final List<AiProviderRequest> requests = new ArrayList<>();
    private long sleepMillis;

    FakeProvider(String id, AiModel model) {
      this(id, List.of(model), true);
    }

    FakeProvider(String id, List<AiModel> models, boolean healthy) {
      this.id = id;
      this.models = List.copyOf(models);
      this.healthy = healthy;
    }

    FakeProvider then(String content) {
      outcomes.add(content);
      return this;
    }

    FakeProvider fail(AiProviderException.Code code, boolean retryable) {
      outcomes.add(new AiProviderException(code, retryable, "boom"));
      return this;
    }

    FakeProvider sleep(long millis) {
      sleepMillis = millis;
      return this;
    }

    @Override
    public String id() {
      return id;
    }

    @Override
    public List<AiModel> models() {
      return models;
    }

    @Override
    public boolean healthy() {
      return healthy;
    }

    @Override
    public String complete(AiProviderRequest request) {
      requests.add(request);
      if (sleepMillis > 0) {
        try {
          Thread.sleep(sleepMillis);
        } catch (InterruptedException ex) {
          Thread.currentThread().interrupt();
          throw new AiProviderException(
              AiProviderException.Code.UNAVAILABLE, true, "interrupted", ex);
        }
      }
      Object outcome = outcomes.isEmpty() ? "ok" : outcomes.remove();
      if (outcome instanceof RuntimeException failure) {
        throw failure;
      }
      return (String) outcome;
    }
  }

  private static final class MutableClock extends Clock {
    private long millis;

    void advance(long delta) {
      millis += delta;
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return Instant.ofEpochMilli(millis);
    }

    @Override
    public long millis() {
      return millis;
    }
  }
}

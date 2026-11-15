package com.awap.ai.application;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/**
 * Vendor-neutral provider gateway (issue #292, C9).
 *
 * <p>Routes by capability, requested model, per-token cost budget and provider health, then falls
 * back through the configured order. Every attempt is recorded with the provider, model and neutral
 * error code; a per-provider circuit breaker prevents one outage from cascading.
 */
@Component
@Primary
@ConditionalOnProperty(name = "awap.ai.gateway.enabled", havingValue = "true")
public class AiProviderGateway implements AiBackendClient {

  private static final Logger log = LoggerFactory.getLogger(AiProviderGateway.class);

  private final Map<String, AiProvider> byId = new LinkedHashMap<>();
  private final Map<String, CircuitBreaker> breakers = new HashMap<>();
  private final Map<String, Long> latencies = new HashMap<>();
  private final List<String> order;
  private final long maxCostMicrosPerToken;
  private final int failureThreshold;
  private final long openMillis;
  private final MeterRegistry registry;
  private final Clock clock;

  @Autowired
  public AiProviderGateway(
      List<AiProvider> providers,
      @Value("${awap.ai.gateway.primary:local}") String primary,
      @Value("${awap.ai.gateway.fallback-order:openai,anthropic,local}") String fallbackOrder,
      @Value("${awap.ai.gateway.max-cost-micros-per-token:0}") long maxCostMicrosPerToken,
      @Value("${awap.ai.gateway.circuit.failure-threshold:3}") int failureThreshold,
      @Value("${awap.ai.gateway.circuit.open-ms:30000}") long openMillis,
      MeterRegistry registry) {
    this(
        providers,
        primary,
        fallbackOrder,
        maxCostMicrosPerToken,
        failureThreshold,
        openMillis,
        registry,
        Clock.systemUTC());
  }

  public AiProviderGateway(
      List<AiProvider> providers,
      String primary,
      String fallbackOrder,
      long maxCostMicrosPerToken,
      int failureThreshold,
      long openMillis,
      MeterRegistry registry,
      Clock clock) {
    this.maxCostMicrosPerToken = maxCostMicrosPerToken;
    this.failureThreshold = failureThreshold;
    this.openMillis = openMillis;
    this.registry = registry;
    this.clock = clock;
    Set<String> seen = new HashSet<>();
    for (AiProvider provider : providers) {
      if (!seen.add(provider.id())) {
        throw new IllegalStateException("Duplicate AI provider id: " + provider.id());
      }
      if (provider.models().isEmpty()) {
        throw new IllegalStateException("AI provider has no models: " + provider.id());
      }
      byId.put(provider.id(), provider);
    }
    this.order = buildOrder(primary, fallbackOrder);
    validate(primary, fallbackOrder);
  }

  @Override
  public String complete(String prompt, int maxTokens) {
    return complete(prompt, maxTokens, null);
  }

  @Override
  public String complete(String prompt, int maxTokens, String model) {
    AiCapability capability = capabilityOf(prompt);
    List<AiProvider> candidates = candidates(capability, model);
    if (candidates.isEmpty()) {
      throw new AiProviderException(
          AiProviderException.Code.NO_PROVIDER,
          false,
          "No AI provider supports "
              + capability
              + (model == null || model.isBlank() ? "" : " with model " + model)
              + ".");
    }
    List<String> failures = new ArrayList<>();
    for (int index = 0; index < candidates.size(); index += 1) {
      AiProvider provider = candidates.get(index);
      String effectiveModel = effectiveModel(provider, model);
      long started = System.nanoTime();
      try {
        String content =
            provider.complete(new AiProviderRequest(prompt, maxTokens, model, capability));
        long elapsed = elapsedMillis(started);
        breaker(provider.id()).recordSuccess();
        latencies.put(provider.id(), elapsed);
        record(provider.id(), effectiveModel, capability, "SUCCESS", elapsed);
        log.info(
            "ai.provider.call provider={} model={} capability={} outcome=SUCCESS fallback={}",
            provider.id(),
            effectiveModel,
            capability,
            failures.isEmpty() ? "NONE" : failures.get(0));
        return content;
      } catch (AiProviderException ex) {
        long elapsed = elapsedMillis(started);
        breaker(provider.id()).recordFailure(now());
        latencies.put(provider.id(), elapsed);
        record(provider.id(), effectiveModel, capability, ex.code().name(), elapsed);
        failures.add(provider.id() + ":" + ex.code());
        String next = index + 1 < candidates.size() ? candidates.get(index + 1).id() : "NONE";
        registry
            .counter(
                "awap.ai.gateway.fallbacks",
                "from",
                provider.id(),
                "to",
                next,
                "reason",
                ex.code().name())
            .increment();
        log.warn(
            "ai.provider.call provider={} model={} capability={} outcome={} fallback={}",
            provider.id(),
            effectiveModel,
            capability,
            ex.code(),
            next);
      }
    }
    throw new AiProviderException(
        AiProviderException.Code.ALL_PROVIDERS_FAILED,
        false,
        "All AI providers failed: " + failures);
  }

  private void record(
      String provider, String model, AiCapability capability, String outcome, long elapsed) {
    registry
        .counter(
            "awap.ai.gateway.requests",
            "provider",
            provider,
            "model",
            model,
            "capability",
            capability.name(),
            "outcome",
            outcome)
        .increment();
    registry
        .timer("awap.ai.gateway.duration", "provider", provider, "outcome", outcome)
        .record(Duration.ofMillis(elapsed));
  }

  private List<AiProvider> candidates(AiCapability capability, String model) {
    List<AiProvider> capable =
        order.stream()
            .map(byId::get)
            .filter(provider -> provider != null && provider.healthy())
            .filter(provider -> supports(provider, capability, model))
            .toList();
    List<AiProvider> affordable =
        capable.stream().filter(provider -> withinBudget(provider, capability, model)).toList();
    List<AiProvider> closed =
        affordable.stream().filter(provider -> breaker(provider.id()).allow(now())).toList();
    List<AiProvider> fast =
        closed.stream().filter(provider -> !slow(provider, capability, model)).toList();
    return fast.isEmpty() ? closed : fast;
  }

  private static boolean supports(AiProvider provider, AiCapability capability, String model) {
    return provider.models().stream()
        .anyMatch(
            candidate ->
                candidate.capabilities().contains(capability)
                    && (model == null || model.isBlank() || candidate.id().equals(model)));
  }

  private boolean withinBudget(AiProvider provider, AiCapability capability, String model) {
    if (maxCostMicrosPerToken <= 0) {
      return true;
    }
    long cheapest =
        provider.models().stream()
            .filter(candidate -> candidate.capabilities().contains(capability))
            .filter(candidate -> model == null || model.isBlank() || candidate.id().equals(model))
            .mapToLong(AiModel::costMicrosPerToken)
            .min()
            .orElse(Long.MAX_VALUE);
    return cheapest <= maxCostMicrosPerToken;
  }

  private boolean slow(AiProvider provider, AiCapability capability, String model) {
    Long average = latencies.get(provider.id());
    if (average == null) {
      return false;
    }
    return provider.models().stream()
        .filter(candidate -> candidate.capabilities().contains(capability))
        .filter(candidate -> model == null || model.isBlank() || candidate.id().equals(model))
        .allMatch(candidate -> average > candidate.latencyBudgetMs());
  }

  private static String effectiveModel(AiProvider provider, String model) {
    if (model != null && !model.isBlank()) {
      return model;
    }
    return provider.models().isEmpty() ? "unknown" : provider.models().get(0).id();
  }

  static AiCapability capabilityOf(String prompt) {
    String normalized = prompt == null ? "" : prompt.toLowerCase(Locale.ROOT);
    if (normalized.startsWith("summarize:")) {
      return AiCapability.SUMMARIZATION;
    }
    if (normalized.startsWith("classify:")) {
      return AiCapability.CLASSIFICATION;
    }
    if (normalized.startsWith("extract:")) {
      return AiCapability.EXTRACTION;
    }
    return AiCapability.TEXT_GENERATION;
  }

  private CircuitBreaker breaker(String providerId) {
    return breakers.computeIfAbsent(
        providerId, id -> new CircuitBreaker(failureThreshold, openMillis));
  }

  private long now() {
    return clock.millis();
  }

  private static long elapsedMillis(long startedNanos) {
    return Math.max(0L, (System.nanoTime() - startedNanos) / 1_000_000L);
  }

  private List<String> buildOrder(String primary, String fallbackOrder) {
    Set<String> ordered = new LinkedHashSet<>();
    ordered.add(primary);
    for (String id : parseOrder(fallbackOrder)) {
      ordered.add(id);
    }
    byId.keySet().stream().sorted().forEach(ordered::add);
    return List.copyOf(ordered);
  }

  private void validate(String primary, String fallbackOrder) {
    if (byId.isEmpty()) {
      throw new IllegalStateException("At least one AI provider must be configured.");
    }
    if (!byId.containsKey(primary)) {
      throw new IllegalStateException("Unknown primary AI provider: " + primary);
    }
    for (String id : parseOrder(fallbackOrder)) {
      if (!byId.containsKey(id)) {
        throw new IllegalStateException("Unknown AI provider in fallback order: " + id);
      }
    }
    if (maxCostMicrosPerToken < 0) {
      throw new IllegalStateException("The AI cost budget must not be negative.");
    }
  }

  private static List<String> parseOrder(String fallbackOrder) {
    if (fallbackOrder == null || fallbackOrder.isBlank()) {
      return List.of();
    }
    return java.util.Arrays.stream(fallbackOrder.split(","))
        .map(String::trim)
        .filter(value -> !value.isEmpty())
        .toList();
  }
}

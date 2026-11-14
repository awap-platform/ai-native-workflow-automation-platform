package com.awap.ai.application;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Per-tenant sliding-window limiter for AI provider calls. It complements the monthly token budget:
 * a burst of cheap prompts cannot starve other tenants even when the token budget is healthy.
 */
@Component
public class AiRateLimiter {

  private static final long WINDOW_SECONDS = 60L;

  private final int limitPerMinute;
  private final Clock clock;
  private final Map<UUID, Deque<Instant>> windows = new ConcurrentHashMap<>();

  @Autowired
  public AiRateLimiter(@Value("${awap.ai.rate-limit-per-minute:60}") int limitPerMinute) {
    this(limitPerMinute, Clock.systemUTC());
  }

  AiRateLimiter(int limitPerMinute, Clock clock) {
    this.limitPerMinute = Math.max(1, limitPerMinute);
    this.clock = clock;
  }

  public boolean tryAcquire(UUID tenantId) {
    Instant now = clock.instant();
    Instant cutoff = now.minusSeconds(WINDOW_SECONDS);
    Deque<Instant> window = windows.computeIfAbsent(tenantId, ignored -> new ArrayDeque<>());
    synchronized (window) {
      while (!window.isEmpty() && window.peekFirst().isBefore(cutoff)) {
        window.removeFirst();
      }
      if (window.size() >= limitPerMinute) {
        return false;
      }
      window.addLast(now);
      return true;
    }
  }

  public int limitPerMinute() {
    return limitPerMinute;
  }
}

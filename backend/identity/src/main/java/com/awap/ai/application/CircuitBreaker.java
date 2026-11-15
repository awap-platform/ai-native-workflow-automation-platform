package com.awap.ai.application;

/**
 * Per-provider circuit breaker (issue #292). It opens after a threshold of failures and allows a
 * single probe after the open window, so an outage cannot cascade through the fallback chain.
 */
public final class CircuitBreaker {

  private final int failureThreshold;
  private final long openMillis;
  private int failures;
  private long openUntil;

  public CircuitBreaker(int failureThreshold, long openMillis) {
    this.failureThreshold = Math.max(1, failureThreshold);
    this.openMillis = Math.max(1L, openMillis);
  }

  public synchronized boolean allow(long now) {
    return openUntil == 0L || now >= openUntil;
  }

  public synchronized void recordSuccess() {
    failures = 0;
    openUntil = 0L;
  }

  public synchronized void recordFailure(long now) {
    failures += 1;
    if (failures >= failureThreshold) {
      openUntil = now + openMillis;
      failures = 0;
    }
  }

  public synchronized boolean open(long now) {
    return openUntil > now;
  }
}

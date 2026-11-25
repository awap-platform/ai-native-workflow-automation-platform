package com.awap.ai.domain;

/** Lifecycle of a persisted human-in-the-loop approval (issue #373). */
public enum CopilotHitlStatus {
  /** Waiting for a reviewer; this is the state a reload must recover. */
  PENDING,
  APPROVED,
  REJECTED
}

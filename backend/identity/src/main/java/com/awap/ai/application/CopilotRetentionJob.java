package com.awap.ai.application;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Enforces the Copilot retention window (issue #373). Runs daily by default; the sweep deletes the
 * rows, so a second run cannot count the same sessions again.
 */
@Component
public class CopilotRetentionJob {

  private static final Logger log = LoggerFactory.getLogger(CopilotRetentionJob.class);

  private final CopilotSessionService service;

  public CopilotRetentionJob(CopilotSessionService service) {
    this.service = service;
  }

  @Scheduled(
      initialDelayString = "${awap.copilot.retention-initial-delay-ms:300000}",
      fixedDelayString = "${awap.copilot.retention-interval-ms:86400000}")
  public void purgeExpiredSessions() {
    int purged = service.purgeExpired(Instant.now());
    if (purged > 0) {
      log.info("Copilot retention removed {} expired session(s).", purged);
    }
  }
}

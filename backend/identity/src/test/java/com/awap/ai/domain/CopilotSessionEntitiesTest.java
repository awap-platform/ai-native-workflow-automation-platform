package com.awap.ai.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Entity accessors plus the redaction policy for persisted Copilot content (issue #373). */
class CopilotSessionEntitiesTest {

  @Test
  void aSessionExposesEveryPersistedField() {
    UUID tenantId = UUID.randomUUID();
    UUID userId = UUID.randomUUID();
    Instant expiresAt = Instant.now().plusSeconds(60);
    CopilotSession session = new CopilotSession(tenantId, userId, "Review", expiresAt);

    assertThat(session.getId()).isNotNull();
    assertThat(session.getTenantId()).isEqualTo(tenantId);
    assertThat(session.getCreatedBy()).isEqualTo(userId);
    assertThat(session.getTitle()).isEqualTo("Review");
    assertThat(session.getCreatedAt()).isNotNull();
    assertThat(session.getUpdatedAt()).isNotNull();
    assertThat(session.isArchived()).isFalse();
    assertThat(session.getExpiresAt()).isEqualTo(expiresAt);
  }

  @Test
  void aSessionCanBeTouchedArchivedAndExpired() {
    CopilotSession session =
        new CopilotSession(
            UUID.randomUUID(), UUID.randomUUID(), "Review", Instant.now().plusSeconds(60));

    session.touch();
    session.archive();

    assertThat(session.isArchived()).isTrue();
    assertThat(session.getUpdatedAt()).isAfterOrEqualTo(session.getCreatedAt());
    assertThat(session.expiredAt(Instant.now())).isFalse();
    assertThat(session.expiredAt(session.getExpiresAt().plusSeconds(1))).isTrue();
  }

  @Test
  void aTurnCarriesItsChainAndDetails() {
    UUID tenantId = UUID.randomUUID();
    UUID sessionId = UUID.randomUUID();
    CopilotTurn turn =
        new CopilotTurn(
            tenantId, sessionId, 2, "assistant", "hi", "a".repeat(64), "b".repeat(64), "key");

    turn.recordDetails("[]", "[]", "{}", "{}");

    assertThat(turn.getId()).isNotNull();
    assertThat(turn.getTenantId()).isEqualTo(tenantId);
    assertThat(turn.getSessionId()).isEqualTo(sessionId);
    assertThat(turn.getSequence()).isEqualTo(2);
    assertThat(turn.getRole()).isEqualTo("assistant");
    assertThat(turn.getContent()).isEqualTo("hi");
    assertThat(turn.getContentHash()).isEqualTo("a".repeat(64));
    assertThat(turn.getPreviousHash()).isEqualTo("b".repeat(64));
    assertThat(turn.getIdempotencyKey()).isEqualTo("key");
    assertThat(turn.getToolCallsJson()).isEqualTo("[]");
    assertThat(turn.getCitationsJson()).isEqualTo("[]");
    assertThat(turn.getBudgetJson()).isEqualTo("{}");
    assertThat(turn.getApprovalJson()).isEqualTo("{}");
    assertThat(turn.getCreatedAt()).isNotNull();
  }

  @Test
  void aHitlRecordStartsPendingAndIsDecidedOnce() {
    UUID reviewer = UUID.randomUUID();
    CopilotHitl record =
        new CopilotHitl(UUID.randomUUID(), UUID.randomUUID(), null, "Review", "{}");

    assertThat(record.getState()).isEqualTo(CopilotHitlStatus.PENDING);
    assertThat(record.isPending()).isTrue();
    assertThat(record.getDecidedBy()).isNull();

    record.decide(CopilotHitlStatus.APPROVED, reviewer);

    assertThat(record.getState()).isEqualTo(CopilotHitlStatus.APPROVED);
    assertThat(record.isPending()).isFalse();
    assertThat(record.getDecidedBy()).isEqualTo(reviewer);
    assertThat(record.getDecidedAt()).isNotNull();
    assertThat(record.getSummary()).isEqualTo("Review");
    assertThat(record.getProposalJson()).isEqualTo("{}");
    assertThat(record.getSessionId()).isNotNull();
    assertThat(record.getTurnId()).isNull();
  }

  @Test
  void redactionMasksCredentialShapedStrings() {
    assertThat(CopilotRedaction.redact("Authorization: Bearer abcdefghijklmnop"))
        .doesNotContain("abcdefghijklmnop")
        .contains("[redacted]");
    assertThat(CopilotRedaction.redact("key sk-abcdefghijklmnopqrstuvwx")).contains("[redacted]");
    assertThat(CopilotRedaction.redact("id AKIAABCDEFGHIJKLMNOP")).contains("[redacted]");
    assertThat(CopilotRedaction.redact("password: hunter2")).doesNotContain("hunter2");
    assertThat(CopilotRedaction.redact("plain text")).isEqualTo("plain text");
    assertThat(CopilotRedaction.redact(null)).isNull();
    assertThat(CopilotRedaction.redact("   ")).isEqualTo("   ");
  }

  @Test
  void theJpaNoArgConstructorsAreRetained() throws Exception {
    CopilotSession session = CopilotSession.class.getDeclaredConstructor().newInstance();
    CopilotTurn turn = CopilotTurn.class.getDeclaredConstructor().newInstance();
    CopilotHitl record = CopilotHitl.class.getDeclaredConstructor().newInstance();

    assertThat(session.getId()).isNull();
    assertThat(turn.getId()).isNull();
    assertThat(record.getId()).isNull();
  }

  @Test
  void theHitlAccessorsExposeTheOwnerAndTimestamps() {
    UUID tenantId = UUID.randomUUID();
    CopilotHitl record = new CopilotHitl(tenantId, UUID.randomUUID(), null, "Review", "{}");

    assertThat(record.getTenantId()).isEqualTo(tenantId);
    assertThat(record.getUpdatedAt()).isEqualTo(record.getCreatedAt());
  }
}

package com.awap.ai.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.ai.domain.CopilotHitl;
import com.awap.ai.domain.CopilotHitlStatus;
import com.awap.ai.domain.CopilotSession;
import com.awap.ai.domain.CopilotTurn;
import com.awap.ai.infrastructure.CopilotHitlRepository;
import com.awap.ai.infrastructure.CopilotSessionRepository;
import com.awap.ai.infrastructure.CopilotTurnRepository;
import com.awap.common.api.AwapException;
import com.awap.engine.application.OutboxEventPublisher;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

@ExtendWith(MockitoExtension.class)
class CopilotSessionServiceTest {

  private static final UUID TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
  private static final UUID USER = UUID.fromString("22222222-2222-2222-2222-222222222222");

  @Mock private CopilotSessionRepository sessions;
  @Mock private CopilotTurnRepository turns;
  @Mock private CopilotHitlRepository hitl;
  @Mock private OutboxEventPublisher outboxEventPublisher;

  private final List<CopilotTurn> storedTurns = new ArrayList<>();
  private CopilotSessionService service;

  @BeforeEach
  void setUp() {
    service =
        new CopilotSessionService(
            sessions, turns, hitl, outboxEventPublisher, new SimpleMeterRegistry());
    lenient().when(sessions.save(any(CopilotSession.class))).thenAnswer(i -> i.getArgument(0));
    lenient().when(turns.save(any(CopilotTurn.class))).thenAnswer(i -> i.getArgument(0));
    lenient().when(hitl.save(any(CopilotHitl.class))).thenAnswer(i -> i.getArgument(0));
    lenient().when(turns.findBySessionIdOrderBySequenceAsc(any())).thenReturn(List.of());
    lenient().when(hitl.findBySessionIdOrderByCreatedAtAsc(any())).thenReturn(List.of());
  }

  private CopilotSession session() {
    CopilotSession session =
        new CopilotSession(TENANT, USER, "Review", Instant.now().plusSeconds(60));
    lenient()
        .when(sessions.findByIdAndTenantId(session.getId(), TENANT))
        .thenReturn(Optional.of(session));
    return session;
  }

  @Test
  void createStoresATenantScopedSession() {
    CopilotSessionService.SessionView view = service.create(TENANT, USER, "  Quarterly review ");

    assertThat(view.title()).isEqualTo("Quarterly review");
    verify(sessions).save(any(CopilotSession.class));
  }

  @Test
  void createFallsBackToADefaultTitleAndTruncatesLongOnes() {
    assertThat(service.create(TENANT, USER, "  ").title()).isEqualTo("New conversation");
    assertThat(service.create(TENANT, USER, "x".repeat(400)).title()).hasSize(255);
  }

  @Test
  void listClampsThePageSizeAndReturnsTheTotal() {
    CopilotSession session = new CopilotSession(TENANT, USER, "A", Instant.now());
    when(sessions.findByTenantIdAndArchivedFalseOrderByUpdatedAtDesc(any(), any(PageRequest.class)))
        .thenReturn(new PageImpl<>(List.of(session)));

    service.list(TENANT, -1, 500);

    org.mockito.ArgumentCaptor<PageRequest> captor =
        org.mockito.ArgumentCaptor.forClass(PageRequest.class);
    verify(sessions).findByTenantIdAndArchivedFalseOrderByUpdatedAtDesc(any(), captor.capture());
    assertThat(captor.getValue().getPageSize()).isEqualTo(100);
    assertThat(captor.getValue().getPageNumber()).isZero();
  }

  @Test
  void listDefaultsToTwentyWhenTheSizeIsMissing() {
    when(sessions.findByTenantIdAndArchivedFalseOrderByUpdatedAtDesc(any(), any(PageRequest.class)))
        .thenReturn(new PageImpl<>(List.of()));

    service.list(TENANT, 0, 0);

    org.mockito.ArgumentCaptor<PageRequest> captor =
        org.mockito.ArgumentCaptor.forClass(PageRequest.class);
    verify(sessions).findByTenantIdAndArchivedFalseOrderByUpdatedAtDesc(any(), captor.capture());
    assertThat(captor.getValue().getPageSize()).isEqualTo(20);
  }

  @Test
  void getReturnsTheThreadAndRejectsAForeignSession() {
    CopilotSession session = session();
    assertThat(service.get(TENANT, session.getId()).id()).isEqualTo(session.getId());
    assertThatThrownBy(() -> service.get(TENANT, UUID.randomUUID()))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("conversation was not found");
  }

  @Test
  void appendTurnChainsTheHashAndRedactsSecrets() {
    CopilotSession session = session();

    CopilotSessionService.TurnView first =
        service.appendTurn(
            TENANT, session.getId(), "USER", "my password: hunter2", null, null, null, null, null);
    storedTurns.add(
        new CopilotTurn(
            TENANT, session.getId(), 1, "user", first.content(), first.contentHash(), null, null));

    assertThat(first.sequence()).isEqualTo(1);
    assertThat(first.role()).isEqualTo("user");
    assertThat(first.content()).contains("[redacted]");
    assertThat(first.previousHash()).isNull();
    assertThat(first.contentHash()).hasSize(64);
  }

  @Test
  void appendTurnIsIdempotentOnTheSameKey() {
    CopilotSession session = session();
    CopilotTurn existing =
        new CopilotTurn(TENANT, session.getId(), 1, "user", "hello", "a".repeat(64), null, "key-1");
    when(turns.findBySessionIdAndIdempotencyKey(session.getId(), "key-1"))
        .thenReturn(Optional.of(existing));

    CopilotSessionService.TurnView view =
        service.appendTurn(
            TENANT, session.getId(), "user", "hello again", "key-1", null, null, null, null);

    assertThat(view.content()).isEqualTo("hello");
    verify(turns, never()).save(any(CopilotTurn.class));
  }

  @Test
  void appendTurnValidatesRoleContentAndSize() {
    CopilotSession session = session();
    assertThatThrownBy(
            () ->
                service.appendTurn(
                    TENANT, session.getId(), "system", "x", null, null, null, null, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("role");
    assertThatThrownBy(
            () ->
                service.appendTurn(
                    TENANT, session.getId(), "user", "  ", null, null, null, null, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("cannot be empty");
    assertThatThrownBy(
            () ->
                service.appendTurn(
                    TENANT,
                    session.getId(),
                    "user",
                    "x".repeat(32_001),
                    null,
                    null,
                    null,
                    null,
                    null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("cannot exceed");
  }

  @Test
  void appendTurnRefusesAnArchivedConversation() {
    CopilotSession session = session();
    session.archive();

    assertThatThrownBy(
            () ->
                service.appendTurn(
                    TENANT, session.getId(), "user", "x", null, null, null, null, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("read-only");
  }

  @Test
  void appendTurnEnforcesTheTurnLimit() {
    CopilotSession session = session();
    List<CopilotTurn> full = new ArrayList<>();
    for (int index = 0; index < 200; index++) {
      full.add(
          new CopilotTurn(
              TENANT, session.getId(), index + 1, "user", "x", "a".repeat(64), null, null));
    }
    when(turns.findBySessionIdOrderBySequenceAsc(session.getId())).thenReturn(full);

    assertThatThrownBy(
            () ->
                service.appendTurn(
                    TENANT, session.getId(), "user", "x", null, null, null, null, null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("turn limit");
  }

  @Test
  void appendTurnLinksThePreviousHashWhenHistoryExists() {
    CopilotSession session = session();
    CopilotTurn previous =
        new CopilotTurn(TENANT, session.getId(), 3, "assistant", "hi", "b".repeat(64), null, null);
    when(turns.findBySessionIdOrderBySequenceAsc(session.getId())).thenReturn(List.of(previous));
    when(turns.findFirstBySessionIdOrderBySequenceDesc(session.getId()))
        .thenReturn(Optional.of(previous));

    CopilotSessionService.TurnView view =
        service.appendTurn(TENANT, session.getId(), "user", "next", null, null, null, null, null);

    assertThat(view.sequence()).isEqualTo(4);
    assertThat(view.previousHash()).isEqualTo("b".repeat(64));
  }

  @Test
  void openHitlStoresAPendingApproval() {
    CopilotSession session = session();

    CopilotSessionService.HitlView view =
        service.openHitl(TENANT, session.getId(), null, "Approve the expense", "{}");

    assertThat(view.state()).isEqualTo("PENDING");
    assertThatThrownBy(() -> service.openHitl(TENANT, session.getId(), null, "  ", null))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("summary is required");
  }

  @Test
  void decideHitlRecordsTheDecisionOnce() {
    CopilotHitl record = new CopilotHitl(TENANT, UUID.randomUUID(), null, "Review", "{}");
    when(hitl.findByIdAndTenantId(record.getId(), TENANT)).thenReturn(Optional.of(record));

    CopilotSessionService.HitlView approved =
        service.decideHitl(TENANT, record.getId(), "approve", USER);

    assertThat(approved.state()).isEqualTo("APPROVED");
    assertThat(approved.decidedBy()).isEqualTo(USER);
    assertThatThrownBy(() -> service.decideHitl(TENANT, record.getId(), "reject", USER))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("already decided");
  }

  @Test
  void decideHitlRejectsUnknownIdsAndBadDecisions() {
    CopilotHitl record = new CopilotHitl(TENANT, UUID.randomUUID(), null, "Review", "{}");
    when(hitl.findByIdAndTenantId(any(), any()))
        .thenAnswer(
            invocation ->
                record.getId().equals(invocation.getArgument(0))
                    ? Optional.of(record)
                    : Optional.empty());

    assertThatThrownBy(() -> service.decideHitl(TENANT, UUID.randomUUID(), "approve", USER))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("was not found");
    assertThatThrownBy(() -> service.decideHitl(TENANT, record.getId(), "maybe", USER))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("APPROVED or REJECTED");
    assertThat(record.getState()).isEqualTo(CopilotHitlStatus.PENDING);
  }

  @Test
  void archiveMarksTheSessionReadOnly() {
    CopilotSession session = session();

    service.archive(TENANT, session.getId());

    assertThat(session.isArchived()).isTrue();
  }

  @Test
  void exportIncludesEverythingAndPublishesTheAuditEvent() {
    CopilotSession session = session();
    when(turns.findBySessionIdOrderBySequenceAsc(session.getId()))
        .thenReturn(
            List.of(
                new CopilotTurn(
                    TENANT, session.getId(), 1, "user", "hi", "a".repeat(64), null, null)));

    CopilotSessionService.ExportView exported = service.export(TENANT, session.getId(), USER);

    assertThat(exported.turns()).hasSize(1);
    assertThat(exported.title()).isEqualTo("Review");
    verify(outboxEventPublisher).publish(any(), anyString(), any(), anyString(), any());
  }

  @Test
  void purgeExpiredDeletesTheRowsOnce() {
    CopilotSession session =
        new CopilotSession(TENANT, USER, "Old", Instant.now().minusSeconds(60));
    when(sessions.findByExpiresAtBefore(any())).thenReturn(List.of(session));

    assertThat(service.purgeExpired(Instant.now())).isEqualTo(1);
    verify(turns).deleteBySessionIdIn(List.of(session.getId()));
    verify(sessions).deleteByIdIn(List.of(session.getId()));

    when(sessions.findByExpiresAtBefore(any())).thenReturn(List.of());
    assertThat(service.purgeExpired(Instant.now())).isZero();
  }

  @Test
  void theRetentionJobCallsTheSweep() {
    when(sessions.findByExpiresAtBefore(any())).thenReturn(List.of());

    new CopilotRetentionJob(service).purgeExpiredSessions();

    verify(sessions).findByExpiresAtBefore(any());
  }

  @Test
  void decideHitlAcceptsARejection() {
    CopilotHitl record = new CopilotHitl(TENANT, UUID.randomUUID(), null, "Review", "{}");
    when(hitl.findByIdAndTenantId(record.getId(), TENANT)).thenReturn(Optional.of(record));

    assertThat(service.decideHitl(TENANT, record.getId(), "REJECT", USER).state())
        .isEqualTo("REJECTED");
  }

  @Test
  void theRetentionJobLogsWhenItRemovedSessions() {
    CopilotSession session =
        new CopilotSession(TENANT, USER, "Old", Instant.now().minusSeconds(60));
    when(sessions.findByExpiresAtBefore(any())).thenReturn(List.of(session));

    new CopilotRetentionJob(service).purgeExpiredSessions();

    verify(sessions).deleteByIdIn(List.of(session.getId()));
  }
}

package com.awap.ai.application;

import com.awap.ai.domain.CopilotHitl;
import com.awap.ai.domain.CopilotHitlStatus;
import com.awap.ai.domain.CopilotRedaction;
import com.awap.ai.domain.CopilotSession;
import com.awap.ai.domain.CopilotTurn;
import com.awap.ai.infrastructure.CopilotHitlRepository;
import com.awap.ai.infrastructure.CopilotSessionRepository;
import com.awap.ai.infrastructure.CopilotTurnRepository;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.engine.application.OutboxEventPublisher;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Server-side Copilot history (issue #373).
 *
 * <p>Three invariants make this evidence rather than a cache: every lookup is tenant-scoped, a turn
 * is appended with its hash chained to the previous turn, and the same {@code Idempotency-Key} can
 * never store a second turn. HITL approvals live here too, so a pending approval survives a crash
 * and a replayed decision is a 409.
 */
@Service
public class CopilotSessionService {

  static final Duration RETENTION = Duration.ofDays(30);
  static final int MAX_CONTENT_LENGTH = 32_000;
  static final int MAX_TURNS_PER_SESSION = 200;
  static final int DEFAULT_PAGE_SIZE = 20;
  static final int MAX_PAGE_SIZE = 100;

  private static final Logger log = LoggerFactory.getLogger(CopilotSessionService.class);

  private final CopilotSessionRepository sessions;
  private final CopilotTurnRepository turns;
  private final CopilotHitlRepository hitl;
  private final OutboxEventPublisher outboxEventPublisher;
  private final Counter created;
  private final Counter appended;
  private final Counter decided;
  private final Counter purged;

  public CopilotSessionService(
      CopilotSessionRepository sessions,
      CopilotTurnRepository turns,
      CopilotHitlRepository hitl,
      OutboxEventPublisher outboxEventPublisher,
      MeterRegistry meterRegistry) {
    this.sessions = sessions;
    this.turns = turns;
    this.hitl = hitl;
    this.outboxEventPublisher = outboxEventPublisher;
    this.created = Counter.builder("awap.copilot.session.created").register(meterRegistry);
    this.appended = Counter.builder("awap.copilot.turn.appended").register(meterRegistry);
    this.decided = Counter.builder("awap.copilot.hitl.decided").register(meterRegistry);
    this.purged = Counter.builder("awap.copilot.session.purged").register(meterRegistry);
  }

  /** Creates a session that lives for {@link #RETENTION}. */
  @Transactional
  public SessionView create(UUID tenantId, UUID userId, String title) {
    String normalized = title == null || title.isBlank() ? "New conversation" : title.trim();
    CopilotSession session =
        new CopilotSession(
            tenantId, userId, truncate(normalized, 255), Instant.now().plus(RETENTION));
    sessions.save(session);
    created.increment();
    return view(session);
  }

  /** Newest first, paginated; the sidebar never loads an unbounded list. */
  @Transactional(readOnly = true)
  public SessionPage list(UUID tenantId, int page, int size) {
    int safeSize = Math.min(MAX_PAGE_SIZE, Math.max(1, size <= 0 ? DEFAULT_PAGE_SIZE : size));
    Page<CopilotSession> result =
        sessions.findByTenantIdAndArchivedFalseOrderByUpdatedAtDesc(
            tenantId, PageRequest.of(Math.max(0, page), safeSize));
    return new SessionPage(
        result.getContent().stream().map(this::view).toList(),
        result.getNumber(),
        result.getSize(),
        result.getTotalElements());
  }

  /** Full thread for hydration: turns in order plus the HITL rows. */
  @Transactional(readOnly = true)
  public ThreadView get(UUID tenantId, UUID sessionId) {
    CopilotSession session = require(tenantId, sessionId);
    return thread(session);
  }

  /**
   * Appends one turn. A repeated {@code Idempotency-Key} returns the stored turn instead of a
   * duplicate, and the content hash chains to the previous turn so an edit is detectable.
   */
  @Transactional
  public TurnView appendTurn(
      UUID tenantId,
      UUID sessionId,
      String role,
      String content,
      String idempotencyKey,
      String toolCallsJson,
      String citationsJson,
      String budgetJson,
      String approvalJson) {
    CopilotSession session = require(tenantId, sessionId);
    if (session.isArchived()) {
      throw new AwapException(
          ErrorCode.RESOURCE_CONFLICT,
          HttpStatus.CONFLICT,
          "The conversation is archived and read-only.");
    }
    String normalizedRole = (role == null ? "user" : role).toLowerCase(Locale.ROOT);
    if (!normalizedRole.equals("user") && !normalizedRole.equals("assistant")) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED,
          HttpStatus.BAD_REQUEST,
          "Turn role must be user or assistant.");
    }
    if (content == null || content.isBlank()) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "A turn cannot be empty.");
    }
    if (content.length() > MAX_CONTENT_LENGTH) {
      throw new AwapException(
          ErrorCode.PAYLOAD_TOO_LARGE,
          HttpStatus.PAYLOAD_TOO_LARGE,
          "A turn cannot exceed " + MAX_CONTENT_LENGTH + " characters.");
    }
    if (idempotencyKey != null && !idempotencyKey.isBlank()) {
      var existing = turns.findBySessionIdAndIdempotencyKey(sessionId, idempotencyKey);
      if (existing.isPresent()) {
        return turnView(existing.get());
      }
    }

    List<CopilotTurn> history = turns.findBySessionIdOrderBySequenceAsc(sessionId);
    if (history.size() >= MAX_TURNS_PER_SESSION) {
      throw new AwapException(
          ErrorCode.PAYLOAD_TOO_LARGE,
          HttpStatus.PAYLOAD_TOO_LARGE,
          "This conversation reached its turn limit; start a new one.");
    }
    String previousHash =
        history.isEmpty() ? null : history.get(history.size() - 1).getContentHash();
    String redacted = CopilotRedaction.redact(content);
    int sequence =
        turns
            .findFirstBySessionIdOrderBySequenceDesc(sessionId)
            .map(last -> last.getSequence() + 1)
            .orElse(1);
    CopilotTurn turn =
        new CopilotTurn(
            tenantId,
            sessionId,
            sequence,
            normalizedRole,
            redacted,
            hash(previousHash, sequence, normalizedRole, redacted),
            previousHash,
            idempotencyKey);
    turn.recordDetails(toolCallsJson, citationsJson, budgetJson, approvalJson);
    turns.save(turn);
    session.touch();
    sessions.save(session);
    appended.increment();
    return turnView(turn);
  }

  /** Persists a pending approval so a reload or a crash can recover the review panel. */
  @Transactional
  public HitlView openHitl(
      UUID tenantId, UUID sessionId, UUID turnId, String summary, String proposalJson) {
    CopilotSession session = require(tenantId, sessionId);
    if (summary == null || summary.isBlank()) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "An approval summary is required.");
    }
    CopilotHitl record =
        new CopilotHitl(
            tenantId,
            sessionId,
            turnId,
            truncate(CopilotRedaction.redact(summary), 1000),
            proposalJson);
    hitl.save(record);
    session.touch();
    sessions.save(session);
    return hitlView(record);
  }

  /** Records the review decision once; a replayed decision answers 409. */
  @Transactional
  public HitlView decideHitl(UUID tenantId, UUID hitlId, String decision, UUID reviewerId) {
    CopilotHitl record =
        hitl.findByIdAndTenantId(hitlId, tenantId)
            .orElseThrow(
                () ->
                    new AwapException(
                        ErrorCode.RESOURCE_NOT_FOUND,
                        HttpStatus.NOT_FOUND,
                        "The approval request was not found."));
    if (!record.isPending()) {
      throw new AwapException(
          ErrorCode.RESOURCE_CONFLICT, HttpStatus.CONFLICT, "This approval was already decided.");
    }
    CopilotHitlStatus status = parseDecision(decision);
    record.decide(status, reviewerId);
    hitl.save(record);
    decided.increment();
    return hitlView(record);
  }

  /** Soft delete: the thread stays readable by an auditor but leaves the sidebar. */
  @Transactional
  public void archive(UUID tenantId, UUID sessionId) {
    CopilotSession session = require(tenantId, sessionId);
    session.archive();
    sessions.save(session);
  }

  /** Compliance export; the fact that it happened is written to the outbox. */
  @Transactional
  public ExportView export(UUID tenantId, UUID sessionId, UUID userId) {
    CopilotSession session = require(tenantId, sessionId);
    ThreadView thread = thread(session);
    outboxEventPublisher.publish(
        tenantId,
        "COPILOT_SESSION",
        session.getId(),
        "COPILOT_SESSION_EXPORTED",
        Map.of("requestedBy", userId, "turns", thread.turns().size()));
    return new ExportView(
        session.getId(),
        session.getTitle(),
        session.getCreatedAt(),
        session.getUpdatedAt(),
        thread.turns(),
        thread.hitl());
  }

  /**
   * Deletes every session past its retention window, including its turns and approvals. The rows
   * are gone after one sweep, so a second sweep cannot count them again.
   */
  @Transactional
  public int purgeExpired(Instant now) {
    List<CopilotSession> expired = sessions.findByExpiresAtBefore(now);
    if (expired.isEmpty()) {
      return 0;
    }
    List<UUID> ids = expired.stream().map(CopilotSession::getId).toList();
    turns.deleteBySessionIdIn(ids);
    hitl.deleteBySessionIdIn(ids);
    sessions.deleteByIdIn(ids);
    purged.increment(ids.size());
    log.info("Purged {} expired Copilot session(s).", ids.size());
    return ids.size();
  }

  private CopilotHitlStatus parseDecision(String decision) {
    String normalized = decision == null ? "" : decision.trim().toUpperCase(Locale.ROOT);
    return switch (normalized) {
      case "APPROVED", "APPROVE" -> CopilotHitlStatus.APPROVED;
      case "REJECTED", "REJECT" -> CopilotHitlStatus.REJECTED;
      default ->
          throw new AwapException(
              ErrorCode.VALIDATION_FAILED,
              HttpStatus.BAD_REQUEST,
              "The decision must be APPROVED or REJECTED.");
    };
  }

  private CopilotSession require(UUID tenantId, UUID sessionId) {
    return sessions
        .findByIdAndTenantId(sessionId, tenantId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.RESOURCE_NOT_FOUND,
                    HttpStatus.NOT_FOUND,
                    "The conversation was not found."));
  }

  private ThreadView thread(CopilotSession session) {
    List<TurnView> threadTurns =
        turns.findBySessionIdOrderBySequenceAsc(session.getId()).stream()
            .map(this::turnView)
            .toList();
    List<HitlView> approvals =
        hitl.findBySessionIdOrderByCreatedAtAsc(session.getId()).stream()
            .map(this::hitlView)
            .toList();
    return new ThreadView(
        session.getId(),
        session.getTitle(),
        session.getCreatedAt(),
        session.getUpdatedAt(),
        session.isArchived(),
        session.getExpiresAt(),
        threadTurns,
        approvals);
  }

  private SessionView view(CopilotSession session) {
    return new SessionView(
        session.getId(),
        session.getTitle(),
        session.getCreatedAt(),
        session.getUpdatedAt(),
        session.isArchived());
  }

  private TurnView turnView(CopilotTurn turn) {
    return new TurnView(
        turn.getId(),
        turn.getSequence(),
        turn.getRole(),
        turn.getContent(),
        turn.getContentHash(),
        turn.getPreviousHash(),
        turn.getToolCallsJson(),
        turn.getCitationsJson(),
        turn.getBudgetJson(),
        turn.getApprovalJson(),
        turn.getIdempotencyKey(),
        turn.getCreatedAt());
  }

  private HitlView hitlView(CopilotHitl record) {
    return new HitlView(
        record.getId(),
        record.getSessionId(),
        record.getTurnId(),
        record.getState().name(),
        record.getSummary(),
        record.getProposalJson(),
        record.getDecidedBy(),
        record.getDecidedAt(),
        record.getCreatedAt());
  }

  private static String hash(String previousHash, int sequence, String role, String content) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      String material =
          (previousHash == null ? "" : previousHash) + "|" + sequence + "|" + role + "|" + content;
      digest.update(material.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException("SHA-256 is not available", ex);
    }
  }

  private static String truncate(String value, int max) {
    return value.length() <= max ? value : value.substring(0, max);
  }

  /** Session row as the sidebar sees it. */
  public record SessionView(
      UUID id, String title, Instant createdAt, Instant updatedAt, boolean archived) {}

  /** One page of sessions. */
  public record SessionPage(List<SessionView> items, int page, int size, long total) {}

  /** One stored turn with its structured payloads. */
  public record TurnView(
      UUID id,
      int sequence,
      String role,
      String content,
      String contentHash,
      String previousHash,
      String toolCallsJson,
      String citationsJson,
      String budgetJson,
      String approvalJson,
      String idempotencyKey,
      Instant createdAt) {}

  /** One persisted HITL approval. */
  public record HitlView(
      UUID id,
      UUID sessionId,
      UUID turnId,
      String state,
      String summary,
      String proposalJson,
      UUID decidedBy,
      Instant decidedAt,
      Instant createdAt) {}

  /** Full thread for hydration. */
  public record ThreadView(
      UUID id,
      String title,
      Instant createdAt,
      Instant updatedAt,
      boolean archived,
      Instant expiresAt,
      List<TurnView> turns,
      List<HitlView> hitl) {}

  /** Compliance export payload. */
  public record ExportView(
      UUID sessionId,
      String title,
      Instant createdAt,
      Instant updatedAt,
      List<TurnView> turns,
      List<HitlView> hitl) {}
}

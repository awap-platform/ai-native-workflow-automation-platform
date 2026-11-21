package com.awap.identity.application;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.engine.application.OutboxRelayStatus;
import com.awap.engine.domain.WorkflowState;
import com.awap.engine.infrastructure.OutboxEventRepository;
import com.awap.engine.infrastructure.WorkflowInstanceRepository;
import com.awap.identity.domain.Invitation;
import com.awap.identity.domain.Permission;
import com.awap.identity.domain.Role;
import com.awap.identity.domain.Tenant;
import com.awap.identity.domain.User;
import com.awap.identity.infrastructure.InvitationRepository;
import com.awap.identity.infrastructure.TenantRepository;
import com.awap.identity.infrastructure.UserRepository;
import com.awap.identity.interfaces.dto.AdminAuditPageResponse;
import com.awap.identity.interfaces.dto.AdminDlqDelivery;
import com.awap.identity.interfaces.dto.AdminDlqRetryResponse;
import com.awap.identity.interfaces.dto.AdminIdentityResponse;
import com.awap.identity.interfaces.dto.AdminInvitationCreated;
import com.awap.identity.interfaces.dto.AdminOperateResponse;
import com.awap.organization.domain.OrganizationAuditEvent;
import com.awap.organization.domain.OrganizationUser;
import com.awap.organization.infrastructure.OrganizationAuditEventRepository;
import com.awap.organization.infrastructure.OrganizationUserRepository;
import com.awap.organization.infrastructure.TeamRepository;
import com.awap.task.domain.TaskStatus;
import com.awap.task.infrastructure.TaskRepository;
import com.awap.workflow.domain.WorkflowStatus;
import com.awap.workflow.infrastructure.WorkflowDefinitionRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Phase 8 identity administration and operator console use cases.
 *
 * <p>Every method is tenant-scoped twice: the caller's tenant context is checked against the
 * requested tenant (a tenant admin can never read another tenant) and the repositories themselves
 * are tenant-scoped. Privileged mutations write an immutable audit row before the response is
 * returned, so a role change or a dead-letter retry is always attributable.
 */
@Service
public class AdminConsoleService {

  public static final int MAX_AUDIT_PAGE_SIZE = 100;
  public static final int MAX_EXPORT_ROWS = 10_000;

  private static final Set<Role> ADMIN_ROLES = Set.of(Role.TENANT_ADMIN, Role.SYSTEM_ADMIN);
  private static final List<TaskStatus> OPEN_TASK_STATUSES =
      List.of(TaskStatus.OPEN, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS);
  private static final int INVITATION_TTL_DAYS = 7;

  private final TenantRepository tenantRepository;
  private final UserRepository userRepository;
  private final InvitationRepository invitationRepository;
  private final TeamRepository teamRepository;
  private final OrganizationUserRepository organizationUserRepository;
  private final WorkflowDefinitionRepository workflowDefinitionRepository;
  private final WorkflowInstanceRepository workflowInstanceRepository;
  private final TaskRepository taskRepository;
  private final OutboxEventRepository outboxEventRepository;
  private final DlqReadPort dlqReadPort;
  private final OrganizationAuditEventRepository auditEventRepository;
  private final OutboxRelayStatus outboxRelayStatus;
  private final int outboxMaxPublishAttempts;

  public AdminConsoleService(
      TenantRepository tenantRepository,
      UserRepository userRepository,
      InvitationRepository invitationRepository,
      TeamRepository teamRepository,
      OrganizationUserRepository organizationUserRepository,
      WorkflowDefinitionRepository workflowDefinitionRepository,
      WorkflowInstanceRepository workflowInstanceRepository,
      TaskRepository taskRepository,
      OutboxEventRepository outboxEventRepository,
      DlqReadPort dlqReadPort,
      OrganizationAuditEventRepository auditEventRepository,
      OutboxRelayStatus outboxRelayStatus,
      @Value("${awap.outbox.max-publish-attempts:5}") int outboxMaxPublishAttempts) {
    this.tenantRepository = tenantRepository;
    this.userRepository = userRepository;
    this.invitationRepository = invitationRepository;
    this.teamRepository = teamRepository;
    this.organizationUserRepository = organizationUserRepository;
    this.workflowDefinitionRepository = workflowDefinitionRepository;
    this.workflowInstanceRepository = workflowInstanceRepository;
    this.taskRepository = taskRepository;
    this.outboxEventRepository = outboxEventRepository;
    this.dlqReadPort = dlqReadPort;
    this.auditEventRepository = auditEventRepository;
    this.outboxRelayStatus = outboxRelayStatus;
    this.outboxMaxPublishAttempts = Math.max(1, outboxMaxPublishAttempts);
  }

  /** Reads the tenant identity administration projection. */
  @Transactional(readOnly = true)
  public AdminIdentityResponse identity(UUID tenantId, UUID callerTenantId, String callerRole) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);
    Tenant tenant = requireTenant(tenantId);

    List<AdminIdentityResponse.AdminUser> users =
        userRepository.findByTenantIdAndDeletedFalseOrderByCreatedAtAsc(tenantId).stream()
            .map(
                user ->
                    new AdminIdentityResponse.AdminUser(
                        user.getId(),
                        user.getEmail(),
                        user.getFullName(),
                        user.getRole().name(),
                        user.isDeleted(),
                        user.getCreatedAt()))
            .toList();

    Map<UUID, Long> membersByTeam =
        organizationUserRepository.findByTenantIdAndDeletedFalse(tenantId).stream()
            .filter(member -> member.getTeamId() != null)
            .collect(Collectors.groupingBy(OrganizationUser::getTeamId, Collectors.counting()));
    List<AdminIdentityResponse.AdminGroup> groups =
        teamRepository.findByTenantIdAndDeletedFalse(tenantId).stream()
            .map(
                team ->
                    new AdminIdentityResponse.AdminGroup(
                        team.getId(), team.getName(), membersByTeam.getOrDefault(team.getId(), 0L)))
            .sorted(Comparator.comparing(AdminIdentityResponse.AdminGroup::name))
            .toList();

    List<AdminIdentityResponse.AdminRole> roles = new ArrayList<>();
    Role[] roleValues = Role.values();
    for (int index = 0; index < roleValues.length; index++) {
      Role role = roleValues[index];
      roles.add(
          new AdminIdentityResponse.AdminRole(
              role.name(),
              index + 1,
              role.permissions().stream().map(Enum::name).sorted().toList()));
    }
    List<AdminIdentityResponse.AdminPermission> permissions =
        List.of(Permission.values()).stream()
            .map(permission -> new AdminIdentityResponse.AdminPermission(permission.name()))
            .toList();
    List<AdminIdentityResponse.AdminInvitation> invitations =
        invitationRepository.findByTenantIdOrderByCreatedAtDesc(tenantId).stream()
            .map(
                invitation ->
                    new AdminIdentityResponse.AdminInvitation(
                        invitation.getId(),
                        invitation.getEmail(),
                        invitation.getRole().name(),
                        invitation.isConsumed(),
                        invitation.getExpiresAt(),
                        invitation.getCreatedAt()))
            .toList();

    return new AdminIdentityResponse(
        tenant.getId(),
        tenant.getPlan(),
        tenant.getMaxUsers(),
        tenant.getMaxWorkflows(),
        tenant.getMaxAiCallsPerMonth(),
        userRepository.countByTenantIdAndDeletedFalse(tenantId),
        workflowDefinitionRepository.countByTenantIdAndDeletedFalse(tenantId),
        users,
        groups,
        roles,
        permissions,
        invitations);
  }

  /** Reads the operate dashboard projection for one tenant. */
  @Transactional(readOnly = true)
  public AdminOperateResponse operate(UUID tenantId, UUID callerTenantId, String callerRole) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);

    long workflowsTotal = workflowDefinitionRepository.countByTenantIdAndDeletedFalse(tenantId);
    long workflowsPublished =
        workflowDefinitionRepository.countByTenantIdAndStatusAndDeletedFalse(
            tenantId, WorkflowStatus.PUBLISHED);
    long workflowsDraft =
        workflowDefinitionRepository.countByTenantIdAndStatusAndDeletedFalse(
            tenantId, WorkflowStatus.DRAFT);

    long instancesTotal = workflowInstanceRepository.countByTenantIdAndDeletedFalse(tenantId);
    long instancesRunning =
        workflowInstanceRepository.countByTenantIdAndStateAndDeletedFalse(
            tenantId, WorkflowState.RUNNING);
    long instancesFailed =
        workflowInstanceRepository.countByTenantIdAndStateAndDeletedFalse(
            tenantId, WorkflowState.FAILED);
    long instancesCompleted =
        workflowInstanceRepository.countByTenantIdAndStateAndDeletedFalse(
            tenantId, WorkflowState.COMPLETED);

    long tasksTotal = taskRepository.countByTenantIdAndDeletedFalse(tenantId);
    long tasksOpen =
        OPEN_TASK_STATUSES.stream()
            .mapToLong(
                status -> taskRepository.countByTenantIdAndStatusAndDeletedFalse(tenantId, status))
            .sum();
    long tasksCompleted =
        taskRepository.countByTenantIdAndStatusAndDeletedFalse(tenantId, TaskStatus.COMPLETED);

    OutboxRelayStatus.Snapshot snapshot = outboxRelayStatus.snapshot();
    String outboxJobStatus =
        !snapshot.hasRun() ? "UNKNOWN" : snapshot.consecutiveFailures() > 0 ? "DOWN" : "UP";
    String lastRun = snapshot.lastRunAt().map(Instant::toString).orElse("not run since start");
    List<AdminOperateResponse.JobHealth> jobs = new ArrayList<>();
    jobs.add(
        new AdminOperateResponse.JobHealth(
            "outbox-relay", outboxJobStatus, "last run: " + lastRun));
    long retrying = dlqReadPort.countRetrying(tenantId);
    jobs.add(
        new AdminOperateResponse.JobHealth(
            "notification-retry",
            retrying == 0 ? "IDLE" : "BACKLOG",
            retrying + " deliveries scheduled for retry"));

    return new AdminOperateResponse(
        tenantId,
        Instant.now(),
        new AdminOperateResponse.WorkflowHealth(workflowsTotal, workflowsPublished, workflowsDraft),
        new AdminOperateResponse.InstanceHealth(
            instancesTotal, instancesRunning, instancesFailed, instancesCompleted),
        new AdminOperateResponse.TaskHealth(tasksTotal, tasksOpen, tasksCompleted),
        new AdminOperateResponse.OutboxHealth(
            outboxEventRepository.countByPublishedFalse(),
            outboxEventRepository.countExhausted(outboxMaxPublishAttempts)),
        new AdminOperateResponse.DlqHealth(dlqReadPort.countFailed(tenantId)),
        List.copyOf(jobs));
  }

  /** Reads one keyset page of the immutable audit trail. */
  @Transactional(readOnly = true)
  public AdminAuditPageResponse audit(
      UUID tenantId, UUID callerTenantId, String callerRole, String cursor, int limit) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);
    if (limit < 1 || limit > MAX_AUDIT_PAGE_SIZE) {
      throw badRequest("limit must be between 1 and " + MAX_AUDIT_PAGE_SIZE + ".");
    }
    Pageable pageable = PageRequest.of(0, limit + 1);
    List<OrganizationAuditEvent> rows;
    if (cursor == null || cursor.isBlank()) {
      rows = auditEventRepository.firstPage(tenantId, pageable);
    } else {
      AuditCursor parsed = decodeCursor(cursor);
      rows = auditEventRepository.pageBefore(tenantId, parsed.createdAt(), parsed.id(), pageable);
    }
    boolean hasMore = rows.size() > limit;
    List<OrganizationAuditEvent> page = hasMore ? rows.subList(0, limit) : rows;
    String nextCursor =
        hasMore && !page.isEmpty()
            ? encodeCursor(
                page.get(page.size() - 1).getCreatedAt(), page.get(page.size() - 1).getId())
            : null;
    return new AdminAuditPageResponse(
        page.stream()
            .map(
                event ->
                    new AdminAuditPageResponse.AuditEntry(
                        event.getId(),
                        event.getEntityType(),
                        event.getEntityId(),
                        event.getAction(),
                        event.getOldValue(),
                        event.getNewValue(),
                        event.getActorId(),
                        event.getCreatedAt()))
            .toList(),
        nextCursor,
        hasMore);
  }

  /** Builds a bounded CSV export of the audit window. */
  @Transactional(readOnly = true)
  public AuditExport exportAudit(
      UUID tenantId, UUID callerTenantId, String callerRole, LocalDate from, LocalDate to) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);
    LocalDate end = to == null ? LocalDate.now(ZoneOffset.UTC) : to;
    LocalDate start = from == null ? end.minusDays(6) : from;
    if (start.isAfter(end)) {
      throw badRequest("from must not be after to.");
    }
    Instant fromInclusive = start.atStartOfDay(ZoneOffset.UTC).toInstant();
    Instant toExclusive = end.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
    List<OrganizationAuditEvent> rows =
        auditEventRepository.exportWindow(
            tenantId, fromInclusive, toExclusive, PageRequest.of(0, MAX_EXPORT_ROWS + 1));
    boolean truncated = rows.size() > MAX_EXPORT_ROWS;
    if (truncated) {
      rows = rows.subList(0, MAX_EXPORT_ROWS);
    }
    StringBuilder csv =
        new StringBuilder("createdAt,entityType,entityId,action,oldValue,newValue,actorId\n");
    for (OrganizationAuditEvent event : rows) {
      csv.append(csvValue(event.getCreatedAt()))
          .append(',')
          .append(csvValue(event.getEntityType()))
          .append(',')
          .append(csvValue(event.getEntityId()))
          .append(',')
          .append(csvValue(event.getAction()))
          .append(',')
          .append(csvValue(event.getOldValue()))
          .append(',')
          .append(csvValue(event.getNewValue()))
          .append(',')
          .append(csvValue(event.getActorId()))
          .append('\n');
    }
    return new AuditExport(csv.toString().getBytes(StandardCharsets.UTF_8), truncated);
  }

  /**
   * Changes one user's role.
   *
   * <p>A caller can only assign its own role or a lower one. The last remaining administrator
   * cannot be demoted, so a tenant can never lock itself out. The change is audited.
   */
  @Transactional
  public AdminIdentityResponse.AdminUser changeRole(
      UUID tenantId,
      UUID callerTenantId,
      String callerRole,
      UUID actorId,
      UUID userId,
      String requestedRole) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);
    Role caller = parseCallerRole(callerRole);
    Role target = parseRole(requestedRole);
    User user = requireUser(tenantId, userId);
    if (!caller.canAssign(target)) {
      throw new AwapException(
          ErrorCode.FORBIDDEN,
          HttpStatus.FORBIDDEN,
          actorId != null && actorId.equals(userId)
              ? "You cannot escalate your own role."
              : "Cannot assign a role above the caller's authority.");
    }
    Role previous = user.getRole();
    if (previous == target) {
      return toAdminUser(user);
    }
    assertNotLastAdmin(tenantId, previous);
    user.assignRole(target);
    userRepository.save(user);
    audit(tenantId, "USER", user.getId(), "ROLE_CHANGED", previous.name(), target.name(), actorId);
    return toAdminUser(user);
  }

  /** Soft-deletes one user; the last administrator cannot be deleted. */
  @Transactional
  public void deleteUser(
      UUID tenantId, UUID callerTenantId, String callerRole, UUID actorId, UUID userId) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);
    User user = requireUser(tenantId, userId);
    assertNotLastAdmin(tenantId, user.getRole());
    user.markDeleted();
    userRepository.save(user);
    audit(tenantId, "USER", user.getId(), "USER_DELETED", user.getRole().name(), null, actorId);
  }

  /** Creates an invitation after enforcing the user quota. Returns the one-time raw token. */
  @Transactional
  public AdminInvitationCreated invite(
      UUID tenantId,
      UUID callerTenantId,
      String callerRole,
      UUID actorId,
      String email,
      String requestedRole) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);
    Tenant tenant = requireTenant(tenantId);
    Role role = parseRole(requestedRole);
    if (invitationRepository.existsByTenantIdAndEmailAndConsumedFalse(tenantId, email)) {
      throw new AwapException(
          ErrorCode.RESOURCE_CONFLICT,
          HttpStatus.CONFLICT,
          "An active invitation already exists for this email.");
    }
    if (userRepository.countByTenantIdAndDeletedFalse(tenantId) >= tenant.getMaxUsers()) {
      throw new AwapException(
          ErrorCode.QUOTA_EXCEEDED,
          HttpStatus.TOO_MANY_REQUESTS,
          "Tenant user quota exceeded. The invitation was not created.");
    }
    String rawToken = UUID.randomUUID().toString();
    Invitation invitation =
        new Invitation(
            tenantId,
            email,
            role,
            hashToken(rawToken),
            Instant.now().plus(Duration.ofDays(INVITATION_TTL_DAYS)),
            actorId);
    invitationRepository.save(invitation);
    audit(
        tenantId,
        "INVITATION",
        invitation.getId(),
        "CREATED",
        null,
        email + ":" + role.name(),
        actorId);
    return new AdminInvitationCreated(
        invitation.getId(),
        invitation.getEmail(),
        invitation.getRole().name(),
        invitation.getExpiresAt(),
        rawToken);
  }

  /** Lists the retryable dead-letter projection (terminally failed notification deliveries). */
  @Transactional(readOnly = true)
  public List<AdminDlqDelivery> dlq(UUID tenantId, UUID callerTenantId, String callerRole) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);
    return dlqReadPort.listFailed(tenantId).stream()
        .map(
            delivery ->
                new AdminDlqDelivery(
                    delivery.id(),
                    delivery.channel(),
                    delivery.recipient(),
                    delivery.templateKey(),
                    delivery.attempts(),
                    delivery.lastError(),
                    delivery.createdAt()))
        .toList();
  }

  /** Re-queues one terminally failed delivery and audits the operator action. */
  @Transactional
  public AdminDlqRetryResponse retryDlq(
      UUID tenantId, UUID callerTenantId, String callerRole, UUID actorId, UUID deliveryId) {
    requireAdmin(callerRole);
    requireAccess(tenantId, callerTenantId, callerRole);
    int updated = dlqReadPort.requeue(tenantId, deliveryId, Instant.now());
    if (updated == 0) {
      throw new AwapException(
          ErrorCode.RESOURCE_CONFLICT,
          HttpStatus.CONFLICT,
          "Only a terminally failed delivery can be retried.");
    }
    audit(
        tenantId, "NOTIFICATION", deliveryId, "DLQ_RETRY_REQUESTED", "FAILED", "RETRYING", actorId);
    return new AdminDlqRetryResponse(
        deliveryId, "RETRYING", 0, "Delivery re-queued for the retry scheduler.");
  }

  private void assertNotLastAdmin(UUID tenantId, Role role) {
    if (!ADMIN_ROLES.contains(role)) {
      return;
    }
    long admins =
        userRepository.countByTenantIdAndRoleAndDeletedFalse(tenantId, Role.TENANT_ADMIN)
            + userRepository.countByTenantIdAndRoleAndDeletedFalse(tenantId, Role.SYSTEM_ADMIN);
    if (admins <= 1) {
      throw new AwapException(
          ErrorCode.RESOURCE_CONFLICT,
          HttpStatus.CONFLICT,
          "The last tenant administrator cannot be removed or demoted.");
    }
  }

  private User requireUser(UUID tenantId, UUID userId) {
    return userRepository
        .findByIdAndTenantId(userId, tenantId)
        .filter(user -> !user.isDeleted())
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND, "The user was not found."));
  }

  private Tenant requireTenant(UUID tenantId) {
    return tenantRepository
        .findByIdRls(tenantId)
        .orElseThrow(
            () ->
                new AwapException(
                    ErrorCode.TENANT_NOT_FOUND, HttpStatus.NOT_FOUND, "The tenant was not found."));
  }

  private void audit(
      UUID tenantId,
      String entityType,
      UUID entityId,
      String action,
      String oldValue,
      String newValue,
      UUID actorId) {
    auditEventRepository.save(
        new OrganizationAuditEvent(
            tenantId, entityType, entityId, action, oldValue, newValue, actorId));
  }

  private AdminIdentityResponse.AdminUser toAdminUser(User user) {
    return new AdminIdentityResponse.AdminUser(
        user.getId(),
        user.getEmail(),
        user.getFullName(),
        user.getRole().name(),
        user.isDeleted(),
        user.getCreatedAt());
  }

  private void requireAdmin(String callerRole) {
    Role role = parseCallerRole(callerRole);
    if (!ADMIN_ROLES.contains(role)) {
      throw new AwapException(
          ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, "Only tenant admins can use the console.");
    }
  }

  private void requireAccess(UUID tenantId, UUID callerTenantId, String callerRole) {
    if (!tenantId.equals(callerTenantId) && !"SYSTEM_ADMIN".equals(callerRole)) {
      throw new AwapException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, "Access denied.");
    }
  }

  private Role parseCallerRole(String callerRole) {
    if (callerRole == null || callerRole.isBlank()) {
      throw new AwapException(
          ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, "A tenant admin role is required.");
    }
    try {
      return Role.valueOf(callerRole.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException ex) {
      throw new AwapException(
          ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, "A tenant admin role is required.");
    }
  }

  private Role parseRole(String requestedRole) {
    if (requestedRole == null || requestedRole.isBlank()) {
      throw badRequest("A role is required.");
    }
    try {
      return Role.valueOf(requestedRole.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException ex) {
      throw badRequest("Unknown role: " + requestedRole);
    }
  }

  private String encodeCursor(Instant createdAt, UUID id) {
    String raw = createdAt.toString() + "|" + id;
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  private AuditCursor decodeCursor(String cursor) {
    try {
      String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int separator = raw.lastIndexOf('|');
      if (separator <= 0 || separator == raw.length() - 1) {
        throw new IllegalArgumentException("missing separator");
      }
      return new AuditCursor(
          Instant.parse(raw.substring(0, separator)),
          UUID.fromString(raw.substring(separator + 1)));
    } catch (RuntimeException ex) {
      throw badRequest("cursor is invalid.");
    }
  }

  private static String csvValue(Object value) {
    if (value == null) {
      return "";
    }
    String text = value.toString();
    if (text.contains(",") || text.contains("\"") || text.contains("\n") || text.contains("\r")) {
      return '"' + text.replace("\"", "\"\"") + '"';
    }
    return text;
  }

  private static AwapException badRequest(String detail) {
    return new AwapException(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, detail);
  }

  private String hashToken(String token) {
    return hashToken(token, "SHA-256");
  }

  /**
   * Package-private seam so the unavailable-algorithm branch is exercised by a test. SHA-256 is
   * mandatory in every JRE, but an unchecked fallback keeps the invitation path honest if it is
   * ever removed from a hardened runtime.
   */
  static String hashToken(String token, String algorithm) {
    try {
      MessageDigest digest = MessageDigest.getInstance(algorithm);
      return HexFormat.of().formatHex(digest.digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException(algorithm + " is not available", ex);
    }
  }

  /** CSV bytes plus whether the row limit truncated the window. */
  public record AuditExport(byte[] body, boolean truncated) {

    @Override
    public boolean equals(Object other) {
      if (this == other) {
        return true;
      }
      if (!(other instanceof AuditExport export)) {
        return false;
      }
      return truncated == export.truncated && Arrays.equals(body, export.body);
    }

    @Override
    public int hashCode() {
      return 31 * Arrays.hashCode(body) + Boolean.hashCode(truncated);
    }

    @Override
    public String toString() {
      return "AuditExport[body=" + body.length + " bytes, truncated=" + truncated + "]";
    }
  }

  private record AuditCursor(Instant createdAt, UUID id) {}
}

package com.awap.identity.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.engine.application.OutboxRelayStatus;
import com.awap.engine.infrastructure.OutboxEventRepository;
import com.awap.engine.infrastructure.WorkflowInstanceRepository;
import com.awap.identity.domain.Invitation;
import com.awap.identity.domain.Role;
import com.awap.identity.domain.Tenant;
import com.awap.identity.domain.User;
import com.awap.identity.infrastructure.InvitationRepository;
import com.awap.identity.infrastructure.TenantRepository;
import com.awap.identity.infrastructure.UserRepository;
import com.awap.identity.interfaces.dto.AdminIdentityResponse;
import com.awap.identity.interfaces.dto.AdminOperateResponse;
import com.awap.organization.domain.OrganizationAuditEvent;
import com.awap.organization.domain.OrganizationUser;
import com.awap.organization.domain.Team;
import com.awap.organization.infrastructure.OrganizationAuditEventRepository;
import com.awap.organization.infrastructure.OrganizationUserRepository;
import com.awap.organization.infrastructure.TeamRepository;
import com.awap.task.infrastructure.TaskRepository;
import com.awap.workflow.infrastructure.WorkflowDefinitionRepository;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AdminConsoleServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private UserRepository userRepository;
  @Mock private InvitationRepository invitationRepository;
  @Mock private TeamRepository teamRepository;
  @Mock private OrganizationUserRepository organizationUserRepository;
  @Mock private WorkflowDefinitionRepository workflowDefinitionRepository;
  @Mock private WorkflowInstanceRepository workflowInstanceRepository;
  @Mock private TaskRepository taskRepository;
  @Mock private OutboxEventRepository outboxEventRepository;
  @Mock private DlqReadPort dlqReadPort;
  @Mock private OrganizationAuditEventRepository auditEventRepository;

  private final UUID tenantId = UUID.randomUUID();
  private final UUID callerTenantId = UUID.randomUUID();
  private final UUID actorId = UUID.randomUUID();
  private OutboxRelayStatus outboxRelayStatus;
  private AdminConsoleService service;

  @BeforeEach
  void setUp() {
    outboxRelayStatus = new OutboxRelayStatus();
    service =
        new AdminConsoleService(
            tenantRepository,
            userRepository,
            invitationRepository,
            teamRepository,
            organizationUserRepository,
            workflowDefinitionRepository,
            workflowInstanceRepository,
            taskRepository,
            outboxEventRepository,
            dlqReadPort,
            auditEventRepository,
            outboxRelayStatus,
            5);
  }

  private User user(Role role) {
    return new User(tenantId, role.name().toLowerCase() + "@acme.test", "hash", role.name(), role);
  }

  private Tenant tenant(int maxUsers) {
    return new Tenant("acme", "Acme", "FREE", maxUsers, 5, 1000);
  }

  @Test
  void identityReturnsUsersGroupsRolesPermissionsAndQuotaUsage() {
    Tenant tenant = tenant(10);
    User user = user(Role.TENANT_ADMIN);
    Team team = new Team(tenantId, UUID.randomUUID(), "Platform");
    OrganizationUser member = mock(OrganizationUser.class);
    when(member.getTeamId()).thenReturn(team.getId());
    Invitation invitation =
        new Invitation(
            tenantId,
            "new@acme.test",
            Role.EMPLOYEE,
            "hash",
            Instant.now().plus(Duration.ofDays(1)),
            actorId);
    when(tenantRepository.findByIdRls(tenantId)).thenReturn(Optional.of(tenant));
    when(userRepository.findByTenantIdAndDeletedFalseOrderByCreatedAtAsc(tenantId))
        .thenReturn(List.of(user));
    when(organizationUserRepository.findByTenantIdAndDeletedFalse(tenantId))
        .thenReturn(List.of(member));
    when(teamRepository.findByTenantIdAndDeletedFalse(tenantId)).thenReturn(List.of(team));
    when(invitationRepository.findByTenantIdOrderByCreatedAtDesc(tenantId))
        .thenReturn(List.of(invitation));
    when(userRepository.countByTenantIdAndDeletedFalse(tenantId)).thenReturn(4L);
    when(workflowDefinitionRepository.countByTenantIdAndDeletedFalse(tenantId)).thenReturn(2L);

    AdminIdentityResponse response = service.identity(tenantId, tenantId, "TENANT_ADMIN");

    assertThat(response.plan()).isEqualTo("FREE");
    assertThat(response.usersUsed()).isEqualTo(4);
    assertThat(response.workflowsUsed()).isEqualTo(2);
    assertThat(response.users()).hasSize(1);
    assertThat(response.groups())
        .extracting(AdminIdentityResponse.AdminGroup::memberCount)
        .containsExactly(1L);
    assertThat(response.roles())
        .extracting(AdminIdentityResponse.AdminRole::name)
        .containsExactly("SYSTEM_ADMIN", "TENANT_ADMIN", "MANAGER", "OPERATIONS", "EMPLOYEE");
    assertThat(response.permissions()).isNotEmpty();
    assertThat(response.invitations()).hasSize(1);
  }

  @Test
  void identityFiltersMembersWithoutATeam() {
    when(tenantRepository.findByIdRls(tenantId)).thenReturn(Optional.of(tenant(10)));
    User user = user(Role.EMPLOYEE);
    when(userRepository.findByTenantIdAndDeletedFalseOrderByCreatedAtAsc(tenantId))
        .thenReturn(List.of(user));
    OrganizationUser member = mock(OrganizationUser.class);
    when(member.getTeamId()).thenReturn(null);
    when(organizationUserRepository.findByTenantIdAndDeletedFalse(tenantId))
        .thenReturn(List.of(member));

    assertThat(service.identity(tenantId, tenantId, "TENANT_ADMIN").groups()).isEmpty();
  }

  @Test
  void identityHidesAnotherTenantFromATenantAdmin() {
    assertThatThrownBy(() -> service.identity(callerTenantId, tenantId, "TENANT_ADMIN"))
        .isInstanceOf(AwapException.class)
        .satisfies(
            error ->
                assertThat(((AwapException) error).status())
                    .isEqualTo(org.springframework.http.HttpStatus.FORBIDDEN));
  }

  @Test
  void identityRejectsNonAdminRoles() {
    assertThatThrownBy(() -> service.identity(tenantId, tenantId, "EMPLOYEE"))
        .isInstanceOf(AwapException.class);
    assertThatThrownBy(() -> service.identity(tenantId, tenantId, " "))
        .isInstanceOf(AwapException.class);
    assertThatThrownBy(() -> service.identity(tenantId, tenantId, "UNKNOWN"))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void identityReportsAMissingTenant() {
    when(tenantRepository.findByIdRls(tenantId)).thenReturn(Optional.empty());
    assertThatThrownBy(() -> service.identity(tenantId, tenantId, "TENANT_ADMIN"))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void changeRoleAssignsALowerRoleAndWritesAnAuditRow() {
    User user = user(Role.EMPLOYEE);
    when(userRepository.findByIdAndTenantId(user.getId(), tenantId)).thenReturn(Optional.of(user));

    AdminIdentityResponse.AdminUser changed =
        service.changeRole(tenantId, tenantId, "TENANT_ADMIN", actorId, user.getId(), "manager");

    assertThat(changed.role()).isEqualTo("MANAGER");
    assertThat(user.getRole()).isEqualTo(Role.MANAGER);
    ArgumentCaptor<OrganizationAuditEvent> audit =
        ArgumentCaptor.forClass(OrganizationAuditEvent.class);
    verify(auditEventRepository).save(audit.capture());
    assertThat(audit.getValue().getEntityType()).isEqualTo("USER");
    assertThat(audit.getValue().getAction()).isEqualTo("ROLE_CHANGED");
    assertThat(audit.getValue().getOldValue()).isEqualTo("EMPLOYEE");
    assertThat(audit.getValue().getNewValue()).isEqualTo("MANAGER");
    assertThat(audit.getValue().getActorId()).isEqualTo(actorId);
  }

  @Test
  void changeRoleBlocksSelfEscalation() {
    User user = user(Role.EMPLOYEE);
    when(userRepository.findByIdAndTenantId(user.getId(), tenantId)).thenReturn(Optional.of(user));

    assertThatThrownBy(
            () ->
                service.changeRole(
                    tenantId, tenantId, "TENANT_ADMIN", user.getId(), user.getId(), "SYSTEM_ADMIN"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("escalate");
    verify(userRepository, never()).save(user);
    verify(auditEventRepository, never()).save(any());
  }

  @Test
  void changeRoleBlocksDemotingTheLastAdministrator() {
    User user = user(Role.TENANT_ADMIN);
    when(userRepository.findByIdAndTenantId(user.getId(), tenantId)).thenReturn(Optional.of(user));
    when(userRepository.countByTenantIdAndRoleAndDeletedFalse(tenantId, Role.TENANT_ADMIN))
        .thenReturn(1L);
    when(userRepository.countByTenantIdAndRoleAndDeletedFalse(tenantId, Role.SYSTEM_ADMIN))
        .thenReturn(0L);

    assertThatThrownBy(
            () ->
                service.changeRole(
                    tenantId, tenantId, "SYSTEM_ADMIN", actorId, user.getId(), "EMPLOYEE"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("last tenant administrator");
  }

  @Test
  void changeRoleIsANoOpWhenTheRoleIsUnchanged() {
    User user = user(Role.OPERATIONS);
    when(userRepository.findByIdAndTenantId(user.getId(), tenantId)).thenReturn(Optional.of(user));

    service.changeRole(tenantId, tenantId, "TENANT_ADMIN", actorId, user.getId(), "OPERATIONS");

    verify(userRepository, never()).save(user);
    verify(auditEventRepository, never()).save(any());
  }

  @Test
  void changeRoleRejectsUnknownRolesAndMissingUsers() {
    assertThatThrownBy(
            () ->
                service.changeRole(
                    tenantId, tenantId, "TENANT_ADMIN", actorId, UUID.randomUUID(), "NOPE"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Unknown role");
    assertThatThrownBy(
            () ->
                service.changeRole(
                    tenantId, tenantId, "TENANT_ADMIN", actorId, UUID.randomUUID(), " "))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("A role is required");
    assertThatThrownBy(
            () ->
                service.changeRole(
                    tenantId, tenantId, "TENANT_ADMIN", actorId, UUID.randomUUID(), "EMPLOYEE"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("user was not found");
  }

  @Test
  void changeRoleAllowsDemotingAnAdministratorWhenAnotherExists() {
    User user = user(Role.TENANT_ADMIN);
    when(userRepository.findByIdAndTenantId(user.getId(), tenantId)).thenReturn(Optional.of(user));
    when(userRepository.countByTenantIdAndRoleAndDeletedFalse(tenantId, Role.TENANT_ADMIN))
        .thenReturn(2L);
    when(userRepository.countByTenantIdAndRoleAndDeletedFalse(tenantId, Role.SYSTEM_ADMIN))
        .thenReturn(0L);

    AdminIdentityResponse.AdminUser changed =
        service.changeRole(tenantId, tenantId, "SYSTEM_ADMIN", actorId, user.getId(), "EMPLOYEE");

    assertThat(changed.role()).isEqualTo("EMPLOYEE");
    verify(auditEventRepository).save(any(OrganizationAuditEvent.class));
  }

  @Test
  void auditExportValueSemanticsCompareArrayContent() {
    var first = new AdminConsoleService.AuditExport(new byte[] {1, 2}, false);
    var same = new AdminConsoleService.AuditExport(new byte[] {1, 2}, false);
    var different = new AdminConsoleService.AuditExport(new byte[] {3}, false);
    var truncated = new AdminConsoleService.AuditExport(new byte[] {1, 2}, true);
    Object sameReference = first;
    Object noExport = null;
    Object otherType = "other";

    assertThat(first.equals(sameReference)).isTrue();
    assertThat(first).isEqualTo(same).isNotEqualTo(different).isNotEqualTo(truncated);
    assertThat(first.equals(noExport)).isFalse();
    assertThat(first.equals(otherType)).isFalse();
    assertThat(first.hashCode()).isEqualTo(same.hashCode());
    assertThat(first.toString()).contains("2 bytes").contains("false");
  }

  @Test
  void hashTokenRejectsAnUnavailableAlgorithm() {
    assertThatThrownBy(() -> AdminConsoleService.hashToken("token", "not-a-real-algorithm"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("not-a-real-algorithm");
  }

  @Test
  void deleteUserSoftDeletesAndAudits() {
    User user = user(Role.EMPLOYEE);
    when(userRepository.findByIdAndTenantId(user.getId(), tenantId)).thenReturn(Optional.of(user));

    service.deleteUser(tenantId, tenantId, "TENANT_ADMIN", actorId, user.getId());

    assertThat(user.isDeleted()).isTrue();
    ArgumentCaptor<OrganizationAuditEvent> audit =
        ArgumentCaptor.forClass(OrganizationAuditEvent.class);
    verify(auditEventRepository).save(audit.capture());
    assertThat(audit.getValue().getAction()).isEqualTo("USER_DELETED");
    assertThat(audit.getValue().getNewValue()).isNull();
  }

  @Test
  void deleteUserBlocksTheLastAdministrator() {
    User user = user(Role.TENANT_ADMIN);
    when(userRepository.findByIdAndTenantId(user.getId(), tenantId)).thenReturn(Optional.of(user));
    when(userRepository.countByTenantIdAndRoleAndDeletedFalse(tenantId, Role.TENANT_ADMIN))
        .thenReturn(1L);

    assertThatThrownBy(
            () -> service.deleteUser(tenantId, tenantId, "SYSTEM_ADMIN", actorId, user.getId()))
        .isInstanceOf(AwapException.class);
    assertThat(user.isDeleted()).isFalse();
  }

  @Test
  void deleteUserRejectsAlreadyDeletedUsers() {
    User user = user(Role.EMPLOYEE);
    user.markDeleted();
    when(userRepository.findByIdAndTenantId(user.getId(), tenantId)).thenReturn(Optional.of(user));

    assertThatThrownBy(
            () -> service.deleteUser(tenantId, tenantId, "TENANT_ADMIN", actorId, user.getId()))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void inviteEnforcesTheUserQuota() {
    when(tenantRepository.findByIdRls(tenantId)).thenReturn(Optional.of(tenant(1)));
    when(userRepository.countByTenantIdAndDeletedFalse(tenantId)).thenReturn(1L);
    when(invitationRepository.existsByTenantIdAndEmailAndConsumedFalse(tenantId, "new@acme.test"))
        .thenReturn(false);

    assertThatThrownBy(
            () ->
                service.invite(
                    tenantId, tenantId, "TENANT_ADMIN", actorId, "new@acme.test", "EMPLOYEE"))
        .isInstanceOf(AwapException.class)
        .satisfies(
            error ->
                assertThat(((AwapException) error).status())
                    .isEqualTo(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS));
  }

  @Test
  void inviteRejectsADuplicateActiveInvitation() {
    when(tenantRepository.findByIdRls(tenantId)).thenReturn(Optional.of(tenant(10)));
    when(invitationRepository.existsByTenantIdAndEmailAndConsumedFalse(tenantId, "new@acme.test"))
        .thenReturn(true);

    assertThatThrownBy(
            () ->
                service.invite(
                    tenantId, tenantId, "TENANT_ADMIN", actorId, "new@acme.test", "EMPLOYEE"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("active invitation");
  }

  @Test
  void inviteCreatesAnInvitationAndAuditsIt() {
    when(tenantRepository.findByIdRls(tenantId)).thenReturn(Optional.of(tenant(10)));
    when(userRepository.countByTenantIdAndDeletedFalse(tenantId)).thenReturn(1L);

    var created =
        service.invite(tenantId, tenantId, "TENANT_ADMIN", actorId, "new@acme.test", "employee");

    assertThat(created.email()).isEqualTo("new@acme.test");
    assertThat(created.role()).isEqualTo("EMPLOYEE");
    assertThat(created.token()).isNotBlank();
    verify(invitationRepository).save(any(Invitation.class));
    ArgumentCaptor<OrganizationAuditEvent> audit =
        ArgumentCaptor.forClass(OrganizationAuditEvent.class);
    verify(auditEventRepository).save(audit.capture());
    assertThat(audit.getValue().getAction()).isEqualTo("CREATED");
  }

  @Test
  void auditPagesWithAnOpaqueKeysetCursor() {
    OrganizationAuditEvent first =
        new OrganizationAuditEvent(
            tenantId, "USER", UUID.randomUUID(), "ROLE_CHANGED", "A", "B", actorId);
    OrganizationAuditEvent second =
        new OrganizationAuditEvent(
            tenantId, "USER", UUID.randomUUID(), "ROLE_CHANGED", "B", "C", actorId);
    OrganizationAuditEvent third =
        new OrganizationAuditEvent(
            tenantId, "USER", UUID.randomUUID(), "ROLE_CHANGED", "C", "D", actorId);
    when(auditEventRepository.firstPage(eq(tenantId), any()))
        .thenReturn(List.of(first, second, third));

    var page = service.audit(tenantId, tenantId, "TENANT_ADMIN", null, 2);

    assertThat(page.items()).hasSize(2);
    assertThat(page.hasMore()).isTrue();
    assertThat(page.nextCursor()).isNotBlank();

    when(auditEventRepository.pageBefore(eq(tenantId), any(), any(), any()))
        .thenReturn(List.of(third));
    var next = service.audit(tenantId, tenantId, "TENANT_ADMIN", page.nextCursor(), 2);
    assertThat(next.items()).hasSize(1);
    assertThat(next.hasMore()).isFalse();
    assertThat(next.nextCursor()).isNull();
  }

  @Test
  void auditRejectsInvalidLimitsAndCursors() {
    assertThatThrownBy(() -> service.audit(tenantId, tenantId, "TENANT_ADMIN", null, 0))
        .isInstanceOf(AwapException.class);
    assertThatThrownBy(() -> service.audit(tenantId, tenantId, "TENANT_ADMIN", null, 101))
        .isInstanceOf(AwapException.class);
    assertThatThrownBy(() -> service.audit(tenantId, tenantId, "TENANT_ADMIN", "not-base64!", 10))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("cursor");
    assertThatThrownBy(
            () -> service.audit(tenantId, tenantId, "TENANT_ADMIN", "bm8tc2VwYXJhdG9y", 10))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void auditHandlesAnEmptyFirstPage() {
    when(auditEventRepository.firstPage(eq(tenantId), any())).thenReturn(List.of());
    var page = service.audit(tenantId, tenantId, "TENANT_ADMIN", null, 25);
    assertThat(page.items()).isEmpty();
    assertThat(page.hasMore()).isFalse();
    assertThat(page.nextCursor()).isNull();
  }

  @Test
  void exportWritesCsvAndEscapesValues() {
    OrganizationAuditEvent event =
        new OrganizationAuditEvent(
            tenantId, "USER", UUID.randomUUID(), "ROLE_CHANGED", "old, value", "a\"b", null);
    when(auditEventRepository.exportWindow(eq(tenantId), any(), any(), any()))
        .thenReturn(List.of(event));

    var export =
        service.exportAudit(
            tenantId,
            tenantId,
            "TENANT_ADMIN",
            java.time.LocalDate.of(2026, 11, 1),
            java.time.LocalDate.of(2026, 11, 21));

    String csv = new String(export.body(), StandardCharsets.UTF_8);
    assertThat(export.truncated()).isFalse();
    assertThat(csv).contains("createdAt,entityType");
    assertThat(csv).contains("\"old, value\"");
    assertThat(csv).contains("\"a\"\"b\"");
  }

  @Test
  void exportTruncatesAtTheRowCeiling() {
    OrganizationAuditEvent event =
        new OrganizationAuditEvent(
            tenantId, "USER", UUID.randomUUID(), "ROLE_CHANGED", "A", "B", actorId);
    when(auditEventRepository.exportWindow(eq(tenantId), any(), any(), any()))
        .thenReturn(Collections.nCopies(AdminConsoleService.MAX_EXPORT_ROWS + 1, event));

    var export = service.exportAudit(tenantId, tenantId, "TENANT_ADMIN", null, null);

    assertThat(export.truncated()).isTrue();
  }

  @Test
  void exportRejectsAReversedRange() {
    assertThatThrownBy(
            () ->
                service.exportAudit(
                    tenantId,
                    tenantId,
                    "TENANT_ADMIN",
                    java.time.LocalDate.of(2026, 11, 21),
                    java.time.LocalDate.of(2026, 11, 1)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("from must not be after to");
  }

  @Test
  void dlqListsFailedDeliveries() {
    when(dlqReadPort.listFailed(tenantId))
        .thenReturn(
            List.of(
                new DlqReadPort.DlqRecord(
                    UUID.randomUUID(),
                    "EMAIL",
                    "ada@acme.test",
                    "task.assigned",
                    3,
                    "smtp timeout",
                    Instant.now())));

    var rows = service.dlq(tenantId, tenantId, "TENANT_ADMIN");

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).recipient()).isEqualTo("ada@acme.test");
    assertThat(rows.get(0).lastError()).isEqualTo("smtp timeout");
  }

  @Test
  void retryDlqRequeuesOnlyTerminallyFailedDeliveries() {
    UUID deliveryId = UUID.randomUUID();
    when(dlqReadPort.requeue(eq(tenantId), eq(deliveryId), any())).thenReturn(1);
    var response = service.retryDlq(tenantId, tenantId, "TENANT_ADMIN", actorId, deliveryId);
    assertThat(response.status()).isEqualTo("RETRYING");
    verify(auditEventRepository).save(any(OrganizationAuditEvent.class));

    when(dlqReadPort.requeue(eq(tenantId), eq(deliveryId), any())).thenReturn(0);
    assertThatThrownBy(
            () -> service.retryDlq(tenantId, tenantId, "TENANT_ADMIN", actorId, deliveryId))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("terminally failed");
  }

  @Test
  void operateReportsCountsAndJobStates() {
    when(workflowDefinitionRepository.countByTenantIdAndDeletedFalse(tenantId)).thenReturn(3L);
    when(workflowDefinitionRepository.countByTenantIdAndStatusAndDeletedFalse(
            tenantId, com.awap.workflow.domain.WorkflowStatus.PUBLISHED))
        .thenReturn(2L);
    when(workflowDefinitionRepository.countByTenantIdAndStatusAndDeletedFalse(
            tenantId, com.awap.workflow.domain.WorkflowStatus.DRAFT))
        .thenReturn(1L);
    when(workflowInstanceRepository.countByTenantIdAndDeletedFalse(tenantId)).thenReturn(9L);
    when(workflowInstanceRepository.countByTenantIdAndStateAndDeletedFalse(
            tenantId, com.awap.engine.domain.WorkflowState.RUNNING))
        .thenReturn(4L);
    when(workflowInstanceRepository.countByTenantIdAndStateAndDeletedFalse(
            tenantId, com.awap.engine.domain.WorkflowState.FAILED))
        .thenReturn(2L);
    when(workflowInstanceRepository.countByTenantIdAndStateAndDeletedFalse(
            tenantId, com.awap.engine.domain.WorkflowState.COMPLETED))
        .thenReturn(3L);
    when(taskRepository.countByTenantIdAndDeletedFalse(tenantId)).thenReturn(10L);
    when(taskRepository.countByTenantIdAndStatusAndDeletedFalse(
            tenantId, com.awap.task.domain.TaskStatus.OPEN))
        .thenReturn(1L);
    when(taskRepository.countByTenantIdAndStatusAndDeletedFalse(
            tenantId, com.awap.task.domain.TaskStatus.ASSIGNED))
        .thenReturn(2L);
    when(taskRepository.countByTenantIdAndStatusAndDeletedFalse(
            tenantId, com.awap.task.domain.TaskStatus.IN_PROGRESS))
        .thenReturn(3L);
    when(taskRepository.countByTenantIdAndStatusAndDeletedFalse(
            tenantId, com.awap.task.domain.TaskStatus.COMPLETED))
        .thenReturn(4L);
    when(outboxEventRepository.countByPublishedFalse()).thenReturn(5L);
    when(outboxEventRepository.countExhausted(5)).thenReturn(1L);
    when(dlqReadPort.countFailed(tenantId)).thenReturn(2L);
    when(dlqReadPort.countRetrying(tenantId)).thenReturn(3L);

    AdminOperateResponse unknown = service.operate(tenantId, tenantId, "TENANT_ADMIN");
    assertThat(unknown.jobs().get(0).status()).isEqualTo("UNKNOWN");
    assertThat(unknown.jobs().get(1).status()).isEqualTo("BACKLOG");
    assertThat(unknown.tasks().open()).isEqualTo(6);
    assertThat(unknown.outbox().pending()).isEqualTo(5);
    assertThat(unknown.dlq().failed()).isEqualTo(2);

    outboxRelayStatus.recordSuccess(0);
    assertThat(service.operate(tenantId, tenantId, "TENANT_ADMIN").jobs().get(0).status())
        .isEqualTo("UP");

    outboxRelayStatus.recordFailure("kafka down", 0);
    assertThat(service.operate(tenantId, tenantId, "TENANT_ADMIN").jobs().get(0).status())
        .isEqualTo("DOWN");
  }

  @Test
  void operateRejectsAnotherTenant() {
    assertThatThrownBy(() -> service.operate(callerTenantId, tenantId, "TENANT_ADMIN"))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void auditRejectsAnotherTenant() {
    assertThatThrownBy(() -> service.audit(callerTenantId, tenantId, "TENANT_ADMIN", null, 10))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void inviteRejectsUnknownRoles() {
    when(tenantRepository.findByIdRls(tenantId)).thenReturn(Optional.of(tenant(10)));
    assertThatThrownBy(
            () -> service.invite(tenantId, tenantId, "TENANT_ADMIN", actorId, "a@b.test", "NOPE"))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Unknown role");
  }

  @Test
  void systemAdminCanReadAnotherTenant() {
    when(tenantRepository.findByIdRls(callerTenantId)).thenReturn(Optional.of(tenant(10)));
    when(userRepository.findByTenantIdAndDeletedFalseOrderByCreatedAtAsc(callerTenantId))
        .thenReturn(List.of());
    when(teamRepository.findByTenantIdAndDeletedFalse(callerTenantId)).thenReturn(List.of());
    when(invitationRepository.findByTenantIdOrderByCreatedAtDesc(callerTenantId))
        .thenReturn(List.of());

    AdminIdentityResponse response = service.identity(callerTenantId, tenantId, "SYSTEM_ADMIN");

    assertThat(response.plan()).isEqualTo("FREE");
    assertThat(response.users()).isEmpty();
  }
}

"use client";

import { useState } from "react";
import { ConfirmationPanel } from "../../../components/admin/ConfirmationPanel";
import { MutationAlert } from "../../../components/admin/MutationAlert";
import { RoleMatrix } from "../../../components/admin/RoleMatrix";
import { StatCard } from "../../../components/admin/StatCard";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PartialState,
} from "../../../components/ui/QueryState";
import type { AdminUserDto } from "../../../lib/api";
import { useActiveRole } from "../../../lib/hooks/useActiveRole";
import { useActiveTenant } from "../../../lib/hooks/useActiveTenant";
import {
  useAdminIdentity,
  useCreateAdminInvitation,
  useDeleteAdminUser,
  useTenantUsage,
  useUpdateAdminUserRole,
} from "../../../lib/hooks/resources";

const ROLES = ["SYSTEM_ADMIN", "TENANT_ADMIN", "MANAGER", "OPERATIONS", "EMPLOYEE"];

export default function AdminIdentityPage() {
  const tenantId = useActiveTenant();
  const activeRole = useActiveRole();
  const identity = useAdminIdentity(tenantId);
  const usage = useTenantUsage(tenantId);
  const roleMutation = useUpdateAdminUserRole();
  const deleteMutation = useDeleteAdminUser();
  const inviteMutation = useCreateAdminInvitation();

  const [pendingRole, setPendingRole] = useState<{
    user: AdminUserDto;
    role: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminUserDto | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("EMPLOYEE");
  const [pendingInvite, setPendingInvite] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  if (identity.isLoading) {
    return <LoadingState label="Loading the identity console…" />;
  }
  if (identity.isError) {
    return (
      <ErrorState
        error={identity.error}
        message="Failed to load the identity console."
        forbiddenMessage="Only a tenant administrator can open the identity console."
      />
    );
  }
  const data = identity.data;
  if (!data) {
    return <ErrorState message="Failed to load the identity console." />;
  }

  const callerRank = data.roles.find((role) => role.name === activeRole)?.rank ?? 0;

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">Identity console</h1>
      <p className="awap-muted">
        Users, groups, roles, permissions, invitations and quota for the active tenant. Every
        role change and deletion is audited.
      </p>

      {status ? (
        <p role="status" className="awap-alert awap-alert-success" data-testid="admin-status">
          {status}
        </p>
      ) : null}
      {createdToken ? (
        <p role="status" className="awap-alert awap-alert-success" data-testid="admin-invitation-token">
          Invitation token (shown once): <span className="awap-mono">{createdToken}</span>
        </p>
      ) : null}

      <section className="awap-panel" aria-label="Tenant plan and quota">
        <h2 className="awap-panel-title">Plan and quota</h2>
        <div className="awap-grid">
          <StatCard label="Plan" value={data.plan} testId="admin-plan" />
          <StatCard
            label="Users"
            value={`${data.usersUsed} / ${data.maxUsers}`}
            detail="used / limit"
            testId="admin-quota-users"
          />
          <StatCard
            label="Workflows"
            value={`${data.workflowsUsed} / ${data.maxWorkflows}`}
            detail="used / limit"
            testId="admin-quota-workflows"
          />
          <StatCard
            label="AI calls per month"
            value={data.maxAiCallsPerMonth}
            detail="monthly limit"
            testId="admin-quota-ai"
          />
        </div>
        {usage.isError ? (
          <PartialState message="Usage metering is unavailable. Plan limits above are still authoritative." />
        ) : usage.data ? (
          <div className="awap-table-wrap">
            <table className="awap-table" data-testid="admin-usage-table">
              <caption className="sr-only">Metered usage for the active tenant</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Total</th>
                  <th scope="col">Limit</th>
                  <th scope="col">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.metrics.map((metric) => (
                  <tr key={metric.key}>
                    <td>{metric.key}</td>
                    <td>{metric.total}</td>
                    <td>{metric.limit < 0 ? "Unlimited" : metric.limit}</td>
                    <td>{metric.remaining < 0 ? "Unlimited" : metric.remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="awap-muted">Loading usage…</p>
        )}
      </section>

      <section className="awap-panel" aria-label="Users">
        <h2 className="awap-panel-title">Users</h2>
        <MutationAlert error={roleMutation.error} action="Role change" />
        <MutationAlert error={deleteMutation.error} action="User deletion" />
        {pendingRole ? (
          <ConfirmationPanel
            id="admin-role-confirm"
            title="Change role?"
            description={`Change ${pendingRole.user.email} from ${pendingRole.user.role} to ${pendingRole.role}. This privileged change is audited.`}
            confirmLabel="Change role"
            busy={roleMutation.isPending}
            onCancel={() => setPendingRole(null)}
            onConfirm={() => {
              roleMutation.mutate(
                { tenantId, userId: pendingRole.user.id, role: pendingRole.role },
                {
                  onSuccess: (updated) => {
                    setStatus(`Role for ${updated.email} changed to ${updated.role}.`);
                    setPendingRole(null);
                  },
                },
              );
            }}
          />
        ) : null}
        {pendingDelete ? (
          <ConfirmationPanel
            id="admin-delete-confirm"
            title="Delete user?"
            description={`Delete ${pendingDelete.email}? The account is soft-deleted and the action is audited. The last tenant administrator cannot be deleted.`}
            confirmLabel="Delete user"
            busy={deleteMutation.isPending}
            danger
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => {
              deleteMutation.mutate(
                { tenantId, userId: pendingDelete.id },
                {
                  onSuccess: () => {
                    setStatus(`${pendingDelete.email} was deleted.`);
                    setPendingDelete(null);
                  },
                },
              );
            }}
          />
        ) : null}
        {data.users.length === 0 ? (
          <EmptyState message="No users in this tenant." />
        ) : (
          <div className="awap-table-wrap">
            <table className="awap-table" data-testid="admin-users-table">
              <caption className="sr-only">Tenant users and roles</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id} data-testid={`admin-user-row-${user.id}`}>
                    <td>{user.email}</td>
                    <td>{user.fullName}</td>
                    <td>
                      <select
                        className="awap-select"
                        aria-label={`Role for ${user.email}`}
                        data-testid={`admin-role-select-${user.id}`}
                        value={user.role}
                        onChange={(event) => {
                          const role = event.target.value;
                          if (role !== user.role) {
                            setPendingRole({ user, role });
                          }
                        }}
                      >
                        {ROLES.map((role) => {
                          const rank = data.roles.find((entry) => entry.name === role)?.rank ?? 0;
                          const aboveCaller = callerRank > 0 && rank < callerRank;
                          return (
                            <option key={role} value={role} disabled={aboveCaller}>
                              {role}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                    <td>{user.createdAt}</td>
                    <td>
                      <button
                        type="button"
                        className="awap-button awap-button-danger"
                        data-testid={`admin-delete-user-${user.id}`}
                        onClick={() => setPendingDelete(user)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="awap-panel" aria-label="Groups">
        <h2 className="awap-panel-title">Groups</h2>
        {data.groups.length === 0 ? (
          <EmptyState message="No teams have been created for this tenant." />
        ) : (
          <div className="awap-table-wrap">
            <table className="awap-table" data-testid="admin-groups-table">
              <caption className="sr-only">Teams and member counts</caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Members</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((group) => (
                  <tr key={group.id}>
                    <td>{group.name}</td>
                    <td>{group.memberCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="awap-panel" aria-label="Invitations">
        <h2 className="awap-panel-title">Invitations</h2>
        <MutationAlert error={inviteMutation.error} action="Invitation" />
        {pendingInvite ? (
          <ConfirmationPanel
            id="admin-invite-confirm"
            title="Create invitation?"
            description={`Invite ${inviteEmail} as ${inviteRole}. This consumes one user quota seat and is audited.`}
            confirmLabel="Create invitation"
            busy={inviteMutation.isPending}
            onCancel={() => setPendingInvite(false)}
            onConfirm={() => {
              inviteMutation.mutate(
                { tenantId, email: inviteEmail, role: inviteRole },
                {
                  onSuccess: (created) => {
                    setStatus(`Invitation created for ${created.email}.`);
                    setCreatedToken(created.token);
                    setInviteEmail("");
                    setPendingInvite(false);
                  },
                },
              );
            }}
          />
        ) : null}
        <form
          className="awap-toolbar"
          data-testid="admin-invite-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (inviteEmail.trim() !== "") {
              setPendingInvite(true);
            }
          }}
        >
          <label className="awap-field awap-field-grow">
            <span className="awap-label">Email</span>
            <input
              type="email"
              className="awap-input"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              required
            />
          </label>
          <label className="awap-field">
            <span className="awap-label">Role</span>
            <select
              className="awap-select"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value)}
            >
              {ROLES.map((role) => {
                const rank = data.roles.find((entry) => entry.name === role)?.rank ?? 0;
                const aboveCaller = callerRank > 0 && rank < callerRank;
                return (
                  <option key={role} value={role} disabled={aboveCaller}>
                    {role}
                  </option>
                );
              })}
            </select>
          </label>
          <button type="submit" className="awap-button awap-button-primary">
            Invite user
          </button>
        </form>
        {data.invitations.length === 0 ? (
          <EmptyState message="No invitations yet." />
        ) : (
          <div className="awap-table-wrap">
            <table className="awap-table" data-testid="admin-invitations-table">
              <caption className="sr-only">Tenant invitations</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td>{invitation.role}</td>
                    <td>{invitation.consumed ? "Accepted" : "Pending"}</td>
                    <td>{invitation.expiresAt}</td>
                    <td>{invitation.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="awap-panel" aria-label="Roles and permissions">
        <h2 className="awap-panel-title">Roles and permissions</h2>
        <RoleMatrix roles={data.roles} permissions={data.permissions} />
      </section>
    </div>
  );
}

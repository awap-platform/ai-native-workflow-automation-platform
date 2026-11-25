import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import * as api from "../../../../lib/api";
import AdminPage from "../page";
import OperatePage from "../operate/page";
import AuditPage from "../audit/page";

jest.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams("from=2026-11-02&to=2026-11-08"),
}));

jest.mock("../../../../lib/api", () => {
  class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError,
    errorStatus: (error: unknown) => (error instanceof ApiError ? error.status : undefined),
    correlationIdOf: () => undefined,
    fetchAdminIdentity: jest.fn(),
    fetchAdminOperate: jest.fn(),
    fetchAdminAudit: jest.fn(),
    fetchAdminDlq: jest.fn(),
    fetchBreakGlassLog: jest.fn(),
    fetchTenantUsage: jest.fn(),
    updateAdminUserRole: jest.fn(),
    deleteAdminUser: jest.fn(),
    createAdminInvitation: jest.fn(),
    retryAdminDlq: jest.fn(),
    adminAuditExportUrl: () => "http://api.test/api/v1/admin/audit/export",
  };
});

const fetchAdminIdentity = api.fetchAdminIdentity as jest.MockedFunction<
  typeof api.fetchAdminIdentity
>;
const fetchAdminOperate = api.fetchAdminOperate as jest.MockedFunction<
  typeof api.fetchAdminOperate
>;
const fetchAdminAudit = api.fetchAdminAudit as jest.MockedFunction<typeof api.fetchAdminAudit>;
const fetchAdminDlq = api.fetchAdminDlq as jest.MockedFunction<typeof api.fetchAdminDlq>;
const fetchBreakGlassLog = api.fetchBreakGlassLog as jest.MockedFunction<
  typeof api.fetchBreakGlassLog
>;
const fetchTenantUsage = api.fetchTenantUsage as jest.MockedFunction<
  typeof api.fetchTenantUsage
>;
const updateAdminUserRole = api.updateAdminUserRole as jest.MockedFunction<
  typeof api.updateAdminUserRole
>;
const deleteAdminUser = api.deleteAdminUser as jest.MockedFunction<typeof api.deleteAdminUser>;
const createAdminInvitation = api.createAdminInvitation as jest.MockedFunction<
  typeof api.createAdminInvitation
>;
const retryAdminDlq = api.retryAdminDlq as jest.MockedFunction<typeof api.retryAdminDlq>;

const identity: api.AdminIdentityDto = {
  tenantId: "tenant-a",
  plan: "FREE",
  maxUsers: 1,
  maxWorkflows: 5,
  maxAiCallsPerMonth: 1000,
  usersUsed: 1,
  workflowsUsed: 2,
  users: [
    {
      id: "user-1",
      email: "ada@acme.com",
      fullName: "Ada Lovelace",
      role: "TENANT_ADMIN",
      deleted: false,
      createdAt: "2026-11-01T10:00:00Z",
    },
  ],
  groups: [{ id: "team-1", name: "Platform", memberCount: 1 }],
  roles: [
    { name: "SYSTEM_ADMIN", rank: 1, permissions: ["TENANT_MANAGE", "USER_MANAGE"] },
    { name: "TENANT_ADMIN", rank: 2, permissions: ["USER_MANAGE", "INSTANCE_READ"] },
    { name: "MANAGER", rank: 3, permissions: ["INSTANCE_READ"] },
    { name: "OPERATIONS", rank: 4, permissions: ["INSTANCE_READ"] },
    { name: "EMPLOYEE", rank: 5, permissions: ["INSTANCE_READ"] },
  ],
  permissions: [{ name: "TENANT_MANAGE" }, { name: "USER_MANAGE" }],
  invitations: [
    {
      id: "invitation-1",
      email: "new@acme.com",
      role: "EMPLOYEE",
      consumed: false,
      expiresAt: "2026-11-20T10:00:00Z",
      createdAt: "2026-11-09T10:00:00Z",
    },
  ],
};

const operate: api.AdminOperateDto = {
  tenantId: "tenant-a",
  generatedAt: "2026-11-09T10:00:00Z",
  workflows: { total: 3, published: 2, draft: 1 },
  instances: { total: 4, running: 1, failed: 1, completed: 2 },
  tasks: { total: 5, open: 2, completed: 3 },
  outbox: { pending: 1, exhausted: 0 },
  dlq: { failed: 1 },
  jobs: [
    { name: "outbox-relay", status: "UP", detail: "last run: now" },
    { name: "notification-retry", status: "BACKLOG", detail: "1 delivery" },
  ],
};

const dlq: api.AdminDlqDeliveryDto[] = [
  {
    id: "delivery-1",
    channel: "EMAIL",
    recipient: "ada@acme.com",
    templateKey: "task.assigned",
    attempts: 3,
    lastError: "smtp timeout",
    createdAt: "2026-11-09T10:00:00Z",
  },
];

const auditPage: api.AdminAuditPageDto = {
  items: [
    {
      id: "audit-1",
      entityType: "USER",
      entityId: "user-1",
      action: "ROLE_CHANGED",
      oldValue: "EMPLOYEE",
      newValue: "MANAGER",
      actorId: "user-1",
      createdAt: "2026-11-09T10:00:00Z",
    },
  ],
  nextCursor: null,
  hasMore: false,
};

const breakGlass: api.BreakGlassLogDto = {
  available: true,
  log: {
    incident: 389,
    owner: "koraysrn",
    opened_at: "2026-11-24T15:17:20Z",
    expiry: "2026-11-25T23:59:59Z",
    reason: "Single maintainer.",
    scope: "Only the approval count was lowered.",
    merges: [
      {
        issue: 366,
        pr: 388,
        merge_sha: "936a7c8786842814f04364f4be9bd77a9b66995f",
        merged_at: "2026-11-24T15:17:37Z",
        checks_green: true,
        restore_apply: "updated",
        restore_verify: "matches",
      },
    ],
  },
};

const usage: api.TenantUsageDto = {
  tenantId: "tenant-a",
  from: "2026-11-02",
  to: "2026-11-08",
  metrics: [
    {
      key: "ai_calls",
      unit: "COUNT",
      total: 12,
      limit: 1000,
      remaining: 988,
      days: [],
    },
  ],
};

function renderPage(page: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<>{page}</>, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.resetAllMocks();
  document.cookie = "awap_tenant=tenant-a; path=/";
  document.cookie = "awap_role=TENANT_ADMIN; path=/";
  fetchAdminIdentity.mockResolvedValue(identity);
  fetchAdminOperate.mockResolvedValue(operate);
  fetchAdminAudit.mockResolvedValue(auditPage);
  fetchAdminDlq.mockResolvedValue(dlq);
  fetchBreakGlassLog.mockResolvedValue(breakGlass);
  fetchTenantUsage.mockResolvedValue(usage);
});

describe("identity console", () => {
  it("renders users, groups, invitations, quota and the permission matrix", async () => {
    renderPage(<AdminPage />);

    expect(await screen.findByTestId("admin-users-table")).toHaveTextContent("ada@acme.com");
    expect(screen.getByTestId("admin-groups-table")).toHaveTextContent("Platform");
    expect(screen.getByTestId("admin-invitations-table")).toHaveTextContent("new@acme.com");
    expect(screen.getByTestId("admin-quota-users-value")).toHaveTextContent("1 / 1");
    expect(screen.getByTestId("admin-usage-table")).toHaveTextContent("ai_calls");
    expect(screen.getByTestId("role-permission-matrix")).toHaveTextContent("TENANT_ADMIN");
  });

  it("confirms and audits a role change, then announces the result (T8-03)", async () => {
    updateAdminUserRole.mockResolvedValue({ ...identity.users[0]!, role: "MANAGER" });
    renderPage(<AdminPage />);

    fireEvent.change(await screen.findByLabelText("Role for ada@acme.com"), {
      target: { value: "MANAGER" },
    });
    const dialog = await screen.findByTestId("admin-role-confirm");
    expect(dialog).toHaveTextContent("audited");

    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    await waitFor(() =>
      expect(updateAdminUserRole).toHaveBeenCalledWith("tenant-a", "user-1", "MANAGER"),
    );
    expect(await screen.findByTestId("admin-status")).toHaveTextContent(
      "Role for ada@acme.com changed to MANAGER.",
    );
  });

  it("surfaces a blocked self-escalation (T8-04, U8-01)", async () => {
    updateAdminUserRole.mockRejectedValue(
      new api.ApiError(403, "You cannot escalate your own role."),
    );
    renderPage(<AdminPage />);

    fireEvent.change(await screen.findByLabelText("Role for ada@acme.com"), {
      target: { value: "EMPLOYEE" },
    });
    fireEvent.click(
      within(await screen.findByTestId("admin-role-confirm")).getByRole("button", {
        name: "Change role",
      }),
    );

    expect(await screen.findByTestId("mutation-error")).toHaveTextContent(
      "You cannot escalate your own role.",
    );
  });

  it("disables roles above the active caller's authority (U8-01)", async () => {
    renderPage(<AdminPage />);
    await screen.findByTestId("admin-users-table");

    const systemAdminOptions = screen.getAllByRole("option", { name: "SYSTEM_ADMIN" });
    expect(systemAdminOptions[0]).toBeDisabled();
  });

  it("blocks deleting the last administrator (U8-02)", async () => {
    deleteAdminUser.mockRejectedValue(
      new api.ApiError(409, "The last tenant administrator cannot be removed or demoted."),
    );
    renderPage(<AdminPage />);

    fireEvent.click(await screen.findByTestId("admin-delete-user-user-1"));
    fireEvent.click(
      within(await screen.findByTestId("admin-delete-confirm")).getByRole("button", {
        name: "Delete user",
      }),
    );

    expect(await screen.findByTestId("mutation-error")).toHaveTextContent(
      "The last tenant administrator cannot be removed or demoted.",
    );
  });

  it("shows the quota message when an invitation would exceed the plan (T8-05)", async () => {
    createAdminInvitation.mockRejectedValue(
      new api.ApiError(429, "Tenant user quota exceeded. The invitation was not created."),
    );
    renderPage(<AdminPage />);

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "new@acme.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite user" }));
    fireEvent.click(
      within(await screen.findByTestId("admin-invite-confirm")).getByRole("button", {
        name: "Create invitation",
      }),
    );

    expect(await screen.findByTestId("mutation-error")).toHaveTextContent(
      "Tenant user quota exceeded.",
    );
  });
});

describe("operate console", () => {
  it("renders the health cards and job states", async () => {
    renderPage(<OperatePage />);

    expect(await screen.findByTestId("operate-workflows-value")).toHaveTextContent("3");
    expect(screen.getByTestId("operate-instances-value")).toHaveTextContent("4");
    expect(screen.getByTestId("operate-outbox-value")).toHaveTextContent("1");
    expect(screen.getByTestId("operate-jobs")).toHaveTextContent("outbox-relay");
    expect(screen.getByTestId("operate-jobs")).toHaveTextContent("BACKLOG");
  });

  it("shows the empty dead-letter state (U8-05)", async () => {
    fetchAdminDlq.mockResolvedValue([]);
    renderPage(<OperatePage />);

    expect(await screen.findByTestId("dlq-empty-state")).toHaveTextContent(
      "The dead-letter queue is empty.",
    );
  });

  it("confirms a retry and announces the result (T8-06)", async () => {
    retryAdminDlq.mockResolvedValue({
      id: "delivery-1",
      status: "RETRYING",
      attempts: 0,
      detail: "Delivery re-queued for the retry scheduler.",
    });
    renderPage(<OperatePage />);

    fireEvent.click(await screen.findByTestId("dlq-retry-delivery-1"));
    fireEvent.click(
      within(await screen.findByTestId("operate-dlq-confirm")).getByRole("button", {
        name: "Retry delivery",
      }),
    );

    expect(await screen.findByTestId("operate-status")).toHaveTextContent(
      "Delivery re-queued for the retry scheduler. Status: RETRYING.",
    );
  });
});

describe("audit console", () => {
  it("renders audit rows and the break-glass log", async () => {
    renderPage(<AuditPage />);

    expect(await screen.findByTestId("audit-table")).toHaveTextContent("ROLE_CHANGED");
    expect(screen.getByTestId("break-glass-summary")).toHaveTextContent("389");
    expect(screen.getByTestId("break-glass-merges")).toHaveTextContent(
      "936a7c8786842814f04364f4be9bd77a9b66995f",
    );
  });

  it("validates a reversed export range (U8-07)", async () => {
    renderPage(<AuditPage />);
    await screen.findByTestId("audit-table");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2099-12-31" } });

    expect(await screen.findByTestId("audit-range-error")).toHaveTextContent(
      "From must not be after to.",
    );
    expect(screen.getByRole("button", { name: "Export audit CSV" })).toBeDisabled();
  });
});

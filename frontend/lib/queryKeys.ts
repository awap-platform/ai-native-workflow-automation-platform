/**
 * Query-key factory (issue #202). Every server resource is addressed through this object so a
 * mutation invalidates the exact keys its readers use and no page invents an ad-hoc array.
 *
 * Keys mirror the historical literals (`["tasks"]`, `["documents"]`, …) so the SSE cache writer in
 * `useDocumentScanStatus` and in-flight caches keep matching.
 */
export const queryKeys = {
  health: {
    status: () => ["health", "status"] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    list: () => ["tasks"] as const,
    mine: () => ["tasks", "mine"] as const,
    comments: (id: string) => ["tasks", id, "comments"] as const,
    attachments: (id: string) => ["tasks", id, "attachments"] as const,
    activity: (id: string) => ["tasks", id, "activity"] as const,
  },
  workflowDefinitions: {
    all: ["workflow-definitions"] as const,
    list: () => ["workflow-definitions"] as const,
    detail: (id: string) => ["workflow-definitions", "detail", id] as const,
    versions: (id: string) => ["workflow-definitions", "versions", id] as const,
  },
  workflowInstances: {
    all: ["instances"] as const,
    list: () => ["instances"] as const,
    detail: (id: string) => ["instances", "detail", id] as const,
    logs: (id: string) => ["instances", "logs", id] as const,
    saga: (id: string) => ["instances", "saga", id] as const,
  },
  documents: {
    all: ["documents"] as const,
    list: () => ["documents"] as const,
    versions: (fileId: string) => ["documents", "versions", fileId] as const,
  },
  forms: {
    all: ["forms"] as const,
    list: () => ["forms"] as const,
    detail: (id: string) => ["forms", "detail", id] as const,
  },
  analytics: {
    all: ["analytics-summary"] as const,
    summary: (from?: string, to?: string) =>
      ["analytics-summary", from ?? null, to ?? null] as const,
    dashboard: (
      from?: string,
      to?: string,
      granularity?: string,
      groupBy?: string,
      limit?: number,
    ) =>
      [
        "analytics-dashboard",
        from ?? null,
        to ?? null,
        granularity ?? null,
        groupBy ?? null,
        limit ?? null,
      ] as const,
    overview: (
      from?: string,
      to?: string,
      granularity?: string,
      groupBy?: string,
      limit?: number,
    ) =>
      [
        "analytics-overview",
        from ?? null,
        to ?? null,
        granularity ?? null,
        groupBy ?? null,
        limit ?? null,
      ] as const,
    drilldown: (from?: string, to?: string, eventType?: string, page?: number, size?: number) =>
      [
        "analytics-drilldown",
        from ?? null,
        to ?? null,
        eventType ?? null,
        page ?? null,
        size ?? null,
      ] as const,
  },
  admin: {
    all: ["admin"] as const,
    identity: (tenantId: string | null) => ["admin", "identity", tenantId] as const,
    operate: (tenantId: string | null) => ["admin", "operate", tenantId] as const,
    audit: (tenantId: string | null, cursor: string | null) =>
      ["admin", "audit", tenantId, cursor] as const,
    dlq: (tenantId: string | null) => ["admin", "dlq", tenantId] as const,
    usage: (tenantId: string | null, from?: string, to?: string) =>
      ["admin", "usage", tenantId, from ?? null, to ?? null] as const,
    breakGlass: () => ["admin", "break-glass"] as const,
  },
  organizationTree: {
    all: ["organization-tree"] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (unreadOnly = false) => ["notifications", unreadOnly] as const,
    unreadCount: () => ["notifications", "unread-count"] as const,
    suppressions: () => ["notifications", "suppressions"] as const,
  },
  notificationTemplates: {
    all: ["notification-templates"] as const,
    list: (templateKey?: string) => ["notification-templates", templateKey ?? "all"] as const,
  },
  tenantMemberships: {
    all: ["tenant-memberships"] as const,
  },
  copilot: {
    all: ["copilot"] as const,
    chat: () => ["copilot", "chat"] as const,
    decision: () => ["copilot", "decision"] as const,
    approval: () => ["copilot", "approval"] as const,
    knowledge: () => ["copilot", "knowledge"] as const,
  },
} as const;

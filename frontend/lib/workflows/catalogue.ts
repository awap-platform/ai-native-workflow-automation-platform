/**
 * Pure workflow catalogue and instance-monitor logic (UI/UX phase 4).
 *
 * The backend returns the tenant's definitions and instances; these helpers do the search, filter,
 * sort, pagination, running-instance stats and log projection without touching React. The 10k
 * instance target (T4-08) is asserted directly against the pipeline in unit tests.
 */

import type {
  ExecutionLogDto,
  SagaDto,
  WorkflowDefinitionDto,
  WorkflowInstanceDto,
} from "../api";

export type WorkflowSort = "updated" | "name" | "version";
export type InstanceSort = "newest" | "oldest" | "state";
export type InstanceFilter = "ALL" | "RUNNING" | "WAITING" | "PAUSED" | "FAILED" | "COMPLETED" | "CANCELLED";

export const WORKFLOW_SORTS: readonly WorkflowSort[] = ["updated", "name", "version"];
export const INSTANCE_FILTERS: readonly InstanceFilter[] = [
  "ALL",
  "RUNNING",
  "WAITING",
  "PAUSED",
  "FAILED",
  "COMPLETED",
  "CANCELLED",
];

export const INSTANCE_PAGE_SIZE = 25;
export const CONTEXT_MAX_LENGTH = 64_000;

export interface WorkflowQuery {
  search: string;
  status: "ALL" | "PUBLISHED" | "DRAFT";
  sort: WorkflowSort;
}

export const DEFAULT_WORKFLOW_QUERY: WorkflowQuery = {
  search: "",
  status: "ALL",
  sort: "updated",
};

function timestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function filterWorkflows(
  workflows: readonly WorkflowDefinitionDto[],
  query: WorkflowQuery,
): WorkflowDefinitionDto[] {
  const needle = query.search.trim().toLowerCase();
  const filtered = workflows.filter((workflow) => {
    if (query.status !== "ALL" && workflow.status !== query.status) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return [workflow.name, workflow.description ?? "", workflow.status]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  return sortWorkflows(filtered, query.sort);
}

export function sortWorkflows(
  workflows: readonly WorkflowDefinitionDto[],
  sort: WorkflowSort,
): WorkflowDefinitionDto[] {
  const rows = [...workflows];
  switch (sort) {
    case "name":
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    case "version":
      return rows.sort((a, b) => b.currentVersion - a.currentVersion || a.name.localeCompare(b.name));
    case "updated":
      return rows.sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.name.localeCompare(b.name));
  }
}

export interface InstanceStats {
  total: number;
  running: number;
}

/** Per-definition live instance counts used by the catalogue cards. */
export function instanceStats(
  instances: readonly WorkflowInstanceDto[],
): Map<string, InstanceStats> {
  const stats = new Map<string, InstanceStats>();
  for (const instance of instances) {
    const current = stats.get(instance.workflowDefinitionId) ?? { total: 0, running: 0 };
    current.total += 1;
    if (["RUNNING", "WAITING", "PAUSED"].includes(instance.state)) {
      current.running += 1;
    }
    stats.set(instance.workflowDefinitionId, current);
  }
  return stats;
}

export function filterInstances(
  instances: readonly WorkflowInstanceDto[],
  filter: InstanceFilter,
  search: string,
  sort: InstanceSort,
): WorkflowInstanceDto[] {
  const needle = search.trim().toLowerCase();
  const rows = instances.filter((instance) => {
    if (filter !== "ALL" && instance.state !== filter) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return [instance.id, instance.workflowDefinitionId, instance.state]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  return sortInstances(rows, sort);
}

export function sortInstances(
  instances: readonly WorkflowInstanceDto[],
  sort: InstanceSort,
): WorkflowInstanceDto[] {
  const rows = [...instances];
  switch (sort) {
    case "oldest":
      return rows.sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt));
    case "state":
      return rows.sort((a, b) => a.state.localeCompare(b.state) || timestamp(b.createdAt) - timestamp(a.createdAt));
    case "newest":
      return rows.sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));
  }
}

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

/** One-based page slice; pages are clamped so a filter change never strands the user. */
export function paginate<T>(items: readonly T[], page: number, pageSize = INSTANCE_PAGE_SIZE): Page<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: current,
    totalPages,
    total,
  };
}

/* ------------------------------------------------------------------ timeline */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_DIGITS = /\b\d{9,}\b/g;

/** Log payloads are operational data; redact obvious PII before rendering or exporting (R4-05). */
export function redactPayload(payload: string | null | undefined): string {
  if (!payload) {
    return "";
  }
  return payload.replace(EMAIL_PATTERN, "[redacted-email]").replace(LONG_DIGITS, "[redacted-number]");
}

export interface TimelineNode {
  nodeId: string;
  nodeType: string;
  events: Array<{ id: string; action: string; time: string; payload: string }>;
}

/**
 * Projection of the execution log into node cards. The API has no separate node endpoint, so the
 * timeline is exactly the recorded log rows grouped by node and ordered by time.
 */
export function buildTimeline(logs: readonly ExecutionLogDto[]): TimelineNode[] {
  const nodes = new Map<string, TimelineNode>();
  for (const log of logs) {
    const key = log.nodeId ?? "instance";
    const node: TimelineNode = nodes.get(key) ?? {
      nodeId: key,
      nodeType: log.nodeType ?? "INSTANCE",
      events: [],
    };
    node.events.push({ id: log.id, action: log.action, time: log.createdAt, payload: log.payload ?? "" });
    nodes.set(key, node);
  }
  return [...nodes.values()];
}

export interface SagaSummary {
  status: string;
  steps: number;
  deadLettered: number;
  compensated: number;
}

export function summarizeSaga(saga: SagaDto | null | undefined): SagaSummary | null {
  if (!saga || Array.isArray(saga) || !Array.isArray(saga.steps)) {
    return null;
  }
  return {
    status: saga.status,
    steps: saga.steps.length,
    deadLettered: saga.steps.filter((step) => step.status === "DEAD_LETTERED").length,
    compensated: saga.steps.filter((step) => step.status === "COMPENSATED").length,
  };
}

/* -------------------------------------------------------------------- context */

export interface ContextParseResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Validates the start-dialog context before any request; also enforces the length limit. */
export function parseContextJson(text: string): ContextParseResult {
  if (text.length > CONTEXT_MAX_LENGTH) {
    return { ok: false, error: "too-long" };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "not-object" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: "invalid-json" };
  }
}

/** A fresh idempotency key per start attempt; retries of the same attempt reuse it. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `start-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* --------------------------------------------------------------------- export */

export function toCsv(rows: readonly WorkflowInstanceDto[], definitionName: (id: string) => string): string {
  const header = ["id", "workflow", "version", "state", "createdAt", "updatedAt"];
  const body = rows.map((row) =>
    [
      row.id,
      definitionName(row.workflowDefinitionId),
      String(row.workflowVersion),
      row.state,
      row.createdAt,
      row.updatedAt ?? "",
    ]
      .map((value) => `"${value.replaceAll('"', '""')}"`)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

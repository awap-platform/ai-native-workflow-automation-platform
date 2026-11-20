"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { WorkflowDefinitionDto } from "../../lib/api";
import { useTasks, useWorkflowDefinitions, useWorkflowInstances } from "../../lib/hooks/resources";
import { formatUtcDateTime } from "../../lib/format";
import {
  DEFAULT_WORKFLOW_QUERY,
  filterWorkflows,
  instanceStats,
  paginate,
  WORKFLOW_SORTS,
  type WorkflowQuery,
} from "../../lib/workflows/catalogue";
import { Badge } from "../ui/surface";
import { Input, Select } from "../ui/form-controls";
import { Pagination } from "../ui/data-display";
import { EmptyState, ErrorState, LoadingState } from "../ui/QueryState";
import { errorStatus } from "../../lib/api";
import StartWorkflowDialog from "./StartWorkflowDialog";

const PAGE_SIZE = 12;

/**
 * Workflow catalogue: hybrid cards/table view with search, status filter, sorting, pagination,
 * ownership, freshness and live instance counts. Draft rows cannot start; they point at the
 * Designer instead (U4-01).
 */
export default function WorkflowCatalogue() {
  const workflows = useWorkflowDefinitions();
  const instances = useWorkflowInstances();
  const tasks = useTasks();
  const [query, setQuery] = useState<WorkflowQuery>(DEFAULT_WORKFLOW_QUERY);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [page, setPage] = useState(1);
  const [starting, setStarting] = useState<WorkflowDefinitionDto | null>(null);

  const rows = useMemo(
    () => filterWorkflows(workflows.data ?? [], query),
    [workflows.data, query],
  );
  const paged = paginate(rows, page, PAGE_SIZE);
  const stats = useMemo(() => instanceStats(instances.data ?? []), [instances.data]);

  const status = errorStatus(workflows.error);
  if (workflows.isLoading) {
    return <LoadingState label="Loading workflows…" />;
  }
  if (status === 403) {
    return <ErrorState error={workflows.error} message="You cannot view workflows." forbiddenMessage="You do not have permission to view workflows." />;
  }
  if (workflows.isError) {
    return (
      <ErrorState
        error={workflows.error}
        message="Failed to load workflows."
        onRetry={() => void workflows.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-4" data-testid="workflow-catalogue">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="awap-page-title">Workflows</h1>
        <p className="text-sm awap-muted">
          {rows.length} definitions · {tasks.data?.length ?? 0} open work items
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Search</span>
          <Input
            type="search"
            value={query.search}
            placeholder="Name, description or status"
            onChange={(event) => {
              setQuery({ ...query, search: event.target.value });
              setPage(1);
            }}
            data-testid="workflow-search"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Status</span>
          <Select
            value={query.status}
            onChange={(event) => {
              setQuery({ ...query, status: event.target.value as WorkflowQuery["status"] });
              setPage(1);
            }}
            data-testid="workflow-status"
          >
            <option value="ALL">All</option>
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Draft</option>
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Sort by</span>
          <Select
            value={query.sort}
            onChange={(event) => setQuery({ ...query, sort: event.target.value as WorkflowQuery["sort"] })}
            data-testid="workflow-sort"
          >
            {WORKFLOW_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {sort === "updated" ? "Last updated" : sort === "version" ? "Version" : "Name"}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`awap-button min-h-9 px-3 py-1 text-sm ${view === "cards" ? "awap-button-primary" : "awap-button-ghost"}`}
          aria-pressed={view === "cards"}
          onClick={() => setView("cards")}
          data-testid="workflow-view-cards"
        >
          Cards
        </button>
        <button
          type="button"
          className={`awap-button min-h-9 px-3 py-1 text-sm ${view === "table" ? "awap-button-primary" : "awap-button-ghost"}`}
          aria-pressed={view === "table"}
          onClick={() => setView("table")}
          data-testid="workflow-view-table"
        >
          Table
        </button>
        <span className="text-xs awap-muted" data-testid="workflow-result-count">
          {paged.total} results
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No workflows match these filters. Create a draft in the Designer." />
      ) : null}

      {starting ? (
        <StartWorkflowDialog
          workflowId={starting.id}
          workflowName={starting.name}
          published={starting.status === "PUBLISHED"}
          onClose={() => setStarting(null)}
        />
      ) : null}

      {view === "cards" ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Workflow definitions">
          {paged.items.map((workflow) => {
            const counts = stats.get(workflow.id) ?? { total: 0, running: 0 };
            const published = workflow.status === "PUBLISHED";
            return (
              <li key={workflow.id} className="awap-card grid gap-2" data-testid={`workflow-card-${workflow.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{workflow.name}</h2>
                    <p className="text-xs awap-muted">{workflow.description ?? "No description"}</p>
                  </div>
                  <Badge variant={published ? "success" : "muted"}>{workflow.status}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="awap-muted">Version</dt>
                  <dd>v{workflow.currentVersion}</dd>
                  <dt className="awap-muted">Owner</dt>
                  <dd className="truncate" title={workflow.createdBy ?? "unknown"}>
                    {workflow.createdBy ? workflow.createdBy.slice(0, 8) : "—"}
                  </dd>
                  <dt className="awap-muted">Updated</dt>
                  <dd>{formatUtcDateTime(workflow.updatedAt)}</dd>
                  <dt className="awap-muted">Running</dt>
                  <dd data-testid={`workflow-running-${workflow.id}`}>
                    {counts.running} / {counts.total}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {published ? (
                    <button
                      type="button"
                      className="awap-button awap-button-primary min-h-11"
                      onClick={() => setStarting(workflow)}
                    >
                      Start
                    </button>
                  ) : (
                    <Link href="/workflows/designer" className="awap-button min-h-11">
                      Publish in Designer
                    </Link>
                  )}
                  <Link href={`/instances?workflow=${workflow.id}`} className="awap-link-button self-center text-sm">
                    View instances
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="awap-table" aria-label="Workflow definitions">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Version</th>
                <th scope="col">Owner</th>
                <th scope="col">Updated</th>
                <th scope="col">Running</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((workflow) => {
                const counts = stats.get(workflow.id) ?? { total: 0, running: 0 };
                return (
                  <tr key={workflow.id} data-testid={`workflow-row-${workflow.id}`}>
                    <td>{workflow.name}</td>
                    <td>{workflow.status}</td>
                    <td>v{workflow.currentVersion}</td>
                    <td className="font-mono text-xs">{workflow.createdBy?.slice(0, 8) ?? "—"}</td>
                    <td>{formatUtcDateTime(workflow.updatedAt)}</td>
                    <td>
                      {counts.running} / {counts.total}
                    </td>
                    <td>
                      {workflow.status === "PUBLISHED" ? (
                        <button type="button" className="awap-link-button" onClick={() => setStarting(workflow)}>
                          Start
                        </button>
                      ) : (
                        <Link href="/workflows/designer" className="awap-link-button">
                          Publish
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paged.totalPages > 1 ? (
        <Pagination page={paged.page} totalPages={paged.totalPages} onPageChange={setPage} ariaLabel="Workflow pages" />
      ) : null}
    </div>
  );
}

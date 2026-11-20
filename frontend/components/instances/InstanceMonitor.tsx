"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useWorkflowDefinitions, useWorkflowInstances } from "../../lib/hooks/resources";
import { formatUtcDateTime } from "../../lib/format";
import {
  filterInstances,
  INSTANCE_FILTERS,
  paginate,
  toCsv,
  type InstanceFilter,
  type InstanceSort,
} from "../../lib/workflows/catalogue";
import { Pagination } from "../ui/data-display";
import { Input, Select } from "../ui/form-controls";
import { EmptyState, ErrorState, LoadingState } from "../ui/QueryState";
import { useToast } from "../ui/overlays";

/**
 * Live instance monitor: one tenant read powers counts, filtering and pagination, so filters do not
 * issue a request per keystroke (the API also supports limit/offset for integrations). Polling is
 * intentional: engine state is the source of truth and the list must converge without a reload.
 */
export default function InstanceMonitor({ initialWorkflowId = null }: { initialWorkflowId?: string | null }) {
  const instances = useWorkflowInstances({ refetchInterval: 5000 });
  const definitions = useWorkflowDefinitions();
  const { toast } = useToast();
  const [filter, setFilter] = useState<InstanceFilter>("ALL");
  const [sort, setSort] = useState<InstanceSort>("newest");
  const [search, setSearch] = useState(initialWorkflowId ?? "");
  const [page, setPage] = useState(1);

  const names = useMemo(() => {
    const map = new Map((definitions.data ?? []).map((workflow) => [workflow.id, workflow.name]));
    return (id: string) => map.get(id) ?? id;
  }, [definitions.data]);

  const rows = useMemo(
    () => filterInstances(instances.data ?? [], filter, search, sort),
    [instances.data, filter, search, sort],
  );
  const paged = paginate(rows, page);

  function exportCsv() {
    const csv = toCsv(rows, names);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "workflow-instances.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export ready", description: `${rows.length} rows exported.`, variant: "success" });
  }

  if (instances.isLoading) {
    return <LoadingState label="Loading workflow instances…" />;
  }
  if (instances.isError) {
    return (
      <ErrorState
        error={instances.error}
        message="Failed to load workflow instances."
        onRetry={() => void instances.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-4" data-testid="instance-monitor">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="awap-page-title">Workflow Instances</h1>
        <p className="text-sm awap-muted" data-testid="instance-result-count">
          {rows.length} instances
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Search</span>
          <Input
            type="search"
            value={search}
            placeholder="Instance id, workflow or state"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            data-testid="instance-search"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">State</span>
          <Select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as InstanceFilter);
              setPage(1);
            }}
            data-testid="instance-filter"
          >
            {INSTANCE_FILTERS.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Sort by</span>
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as InstanceSort)}
            data-testid="instance-sort"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="state">State</option>
          </Select>
        </label>
        <button type="button" className="awap-button min-h-11 self-end" onClick={exportCsv} data-testid="instance-export">
          Export CSV
        </button>
      </div>

      {rows.length === 0 ? <EmptyState message="No instances match these filters." /> : null}

      <ul className="awap-list" aria-label="Workflow instances">
        {paged.items.map((instance) => (
          <li key={instance.id} className="awap-list-row" data-testid={`instance-row-${instance.id}`}>
            <div className="grid min-w-0 gap-1">
              <Link href={`/instances/${instance.id}`} className="awap-link-button font-semibold">
                {names(instance.workflowDefinitionId)}
              </Link>
              <span className="truncate font-mono text-xs awap-muted">{instance.id}</span>
              <span className="truncate font-mono text-xs awap-muted">
                {instance.workflowDefinitionId}
              </span>
              <span className="text-xs awap-muted">
                v{instance.workflowVersion} · {formatUtcDateTime(instance.createdAt)}
              </span>
            </div>
            <span className={`awap-state awap-state-${instance.state.toLowerCase()}`}>{instance.state}</span>
          </li>
        ))}
      </ul>

      {paged.totalPages > 1 ? (
        <Pagination page={paged.page} totalPages={paged.totalPages} onPageChange={setPage} ariaLabel="Instance pages" />
      ) : null}
    </div>
  );
}

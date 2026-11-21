"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConfirmationPanel } from "../../../../components/admin/ConfirmationPanel";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PartialState,
} from "../../../../components/ui/QueryState";
import { adminAuditExportUrl } from "../../../../lib/api";
import { fetchExport, saveExport } from "../../../../lib/export";
import { useActiveTenant } from "../../../../lib/hooks/useActiveTenant";
import { useAdminAudit, useBreakGlassLog } from "../../../../lib/hooks/resources";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function initialRange(params: URLSearchParams): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
  return {
    from: validDate(params.get("from")) ?? isoDate(from),
    to: validDate(params.get("to")) ?? isoDate(to),
  };
}

function asText(log: Record<string, unknown> | null, key: string): string {
  const value = log?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

function AuditScreen() {
  const searchParams = useSearchParams();
  const tenantId = useActiveTenant();
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([null]);
  const [query, setQuery] = useState("");
  const audit = useAdminAudit(tenantId, cursor);
  const breakGlass = useBreakGlassLog();

  const [exportRange, setExportRange] = useState(() => initialRange(searchParams));
  const [confirmExport, setConfirmExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const reversed =
    exportRange.from !== "" && exportRange.to !== "" && exportRange.from > exportRange.to;

  const rows = useMemo(() => {
    const items = audit.data?.items ?? [];
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return items;
    }
    return items.filter((entry) =>
      [entry.entityType, entry.action, entry.oldValue ?? "", entry.newValue ?? "", entry.actorId ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [audit.data, query]);

  const log = breakGlass.data?.log ?? null;
  const merges = Array.isArray(log?.merges)
    ? (log?.merges as Array<Record<string, unknown>>)
    : [];

  async function runExport() {
    setExporting(true);
    setExportError(null);
    setExportStatus("Preparing the audit export…");
    try {
      const result = await fetchExport({
        url: adminAuditExportUrl(tenantId ?? undefined, exportRange.from, exportRange.to),
        onRetry: () => setExportStatus("The export timed out; retrying once…"),
      });
      saveExport(result.blob, "awap-audit.csv");
      setExportStatus(
        `Audit export ready: ${result.bytes} bytes.` +
          (result.truncated ? " The export hit the 10,000-row ceiling and was truncated." : "") +
          (result.usedRetry ? " The request timed out once and was retried." : ""),
      );
    } catch (error) {
      setExportStatus(null);
      setExportError(error instanceof Error ? error.message : "The audit export failed.");
    } finally {
      setExporting(false);
      setConfirmExport(false);
    }
  }

  if (audit.isLoading) {
    return <LoadingState label="Loading the audit log…" />;
  }
  if (audit.isError) {
    return (
      <ErrorState
        error={audit.error}
        message="Failed to load the audit log."
        forbiddenMessage="Only a tenant administrator can read the audit log."
      />
    );
  }

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">Audit log</h1>
      <p className="awap-muted">
        Immutable tenant audit events plus the committed break-glass governance record. Exports are
        bounded and every privileged mutation is attributed to an actor.
      </p>

      {exportStatus ? (
        <p role="status" className="awap-alert awap-alert-success" data-testid="audit-export-status">
          {exportStatus}
        </p>
      ) : null}
      {exportError ? (
        <p role="alert" className="awap-alert awap-alert-danger" data-testid="audit-export-error">
          {exportError}
        </p>
      ) : null}

      <section className="awap-panel" aria-label="Audit export">
        <h2 className="awap-panel-title">Export audit window</h2>
        <div className="awap-toolbar" role="search" aria-label="Audit export range">
          <label className="awap-field">
            <span className="awap-label">From</span>
            <input
              type="date"
              className="awap-input"
              value={exportRange.from}
              onChange={(event) => setExportRange({ ...exportRange, from: event.target.value })}
            />
          </label>
          <label className="awap-field">
            <span className="awap-label">To</span>
            <input
              type="date"
              className="awap-input"
              value={exportRange.to}
              onChange={(event) => setExportRange({ ...exportRange, to: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="awap-button"
            onClick={() => setConfirmExport(true)}
            disabled={reversed}
          >
            Export audit CSV
          </button>
        </div>
        {reversed ? (
          <p role="alert" className="awap-alert awap-alert-danger" data-testid="audit-range-error">
            From must not be after to.
          </p>
        ) : null}
        {confirmExport ? (
          <ConfirmationPanel
            id="audit-export-confirmation"
            title="Export audit log?"
            description={`This exports ${exportRange.from} to ${exportRange.to} as CSV, capped at 10,000 rows.`}
            confirmLabel="Export CSV"
            busy={exporting}
            onCancel={() => setConfirmExport(false)}
            onConfirm={() => void runExport()}
          />
        ) : null}
      </section>

      <section className="awap-panel" aria-label="Audit events">
        <div className="awap-card-header">
          <h2 className="awap-panel-title">Audit events</h2>
          <label className="awap-field">
            <span className="awap-label">Filter this page</span>
            <input
              type="search"
              className="awap-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {rows.length === 0 ? (
          <EmptyState message="No audit events on this page." />
        ) : (
          <div className="awap-table-wrap">
            <table className="awap-table" data-testid="audit-table">
              <caption className="sr-only">Immutable tenant audit events</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Action</th>
                  <th scope="col">Old value</th>
                  <th scope="col">New value</th>
                  <th scope="col">Actor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} data-testid={`audit-row-${entry.id}`}>
                    <td>{entry.createdAt}</td>
                    <td>
                      {entry.entityType}
                      <span className="awap-mono"> {entry.entityId}</span>
                    </td>
                    <td>{entry.action}</td>
                    <td>{entry.oldValue ?? "—"}</td>
                    <td>{entry.newValue ?? "—"}</td>
                    <td className="awap-mono">{entry.actorId ?? "system"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="awap-inline">
          <button
            type="button"
            className="awap-button"
            disabled={history.length <= 1}
            onClick={() => {
              const nextHistory = history.slice(0, -1);
              setHistory(nextHistory);
              setCursor(nextHistory[nextHistory.length - 1] ?? null);
            }}
          >
            Newer page
          </button>
          <button
            type="button"
            className="awap-button"
            disabled={!audit.data?.hasMore || !audit.data?.nextCursor}
            onClick={() => {
              const next = audit.data?.nextCursor;
              if (next) {
                setHistory([...history, next]);
                setCursor(next);
              }
            }}
          >
            Older page
          </button>
        </div>
      </section>

      <section className="awap-panel" aria-label="Break-glass log">
        <h2 className="awap-panel-title">Break-glass governance log</h2>
        {breakGlass.isLoading ? <p className="awap-muted">Loading break-glass log…</p> : null}
        {breakGlass.isError ? (
          <PartialState message="The break-glass log could not be loaded." />
        ) : null}
        {breakGlass.data && !breakGlass.data.available ? (
          <PartialState message="The committed break-glass log is unavailable. No exception is implied or hidden." />
        ) : null}
        {log ? (
          <>
            <dl className="awap-grid" data-testid="break-glass-summary">
              <div>
                <dt className="awap-stat-label">Incident</dt>
                <dd>{asText(log, "incident")}</dd>
              </div>
              <div>
                <dt className="awap-stat-label">Owner</dt>
                <dd>{asText(log, "owner")}</dd>
              </div>
              <div>
                <dt className="awap-stat-label">Opened</dt>
                <dd>{asText(log, "opened_at")}</dd>
              </div>
              <div>
                <dt className="awap-stat-label">Expiry</dt>
                <dd>{asText(log, "expiry")}</dd>
              </div>
            </dl>
            <p>{asText(log, "reason")}</p>
            <p className="awap-muted">{asText(log, "scope")}</p>
            {merges.length === 0 ? (
              <EmptyState message="No break-glass merges are recorded." />
            ) : (
              <div className="awap-table-wrap">
                <table className="awap-table" data-testid="break-glass-merges">
                  <caption className="sr-only">Break-glass merges</caption>
                  <thead>
                    <tr>
                      <th scope="col">Issue</th>
                      <th scope="col">PR</th>
                      <th scope="col">Merge commit</th>
                      <th scope="col">Merged at</th>
                      <th scope="col">Checks green</th>
                      <th scope="col">Protection restored</th>
                    </tr>
                  </thead>
                  <tbody>
                    {merges.map((merge, index) => (
                      <tr key={`${asText(merge, "merge_sha")}-${index}`}>
                        <td>{asText(merge, "issue")}</td>
                        <td>{asText(merge, "pr")}</td>
                        <td className="awap-mono">{asText(merge, "merge_sha")}</td>
                        <td>{asText(merge, "merged_at")}</td>
                        <td>{merge.checks_green === true ? "Yes" : "No"}</td>
                        <td>
                          {asText(merge, "restore_apply")} / {asText(merge, "restore_verify")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

/** Route wrapper: `useSearchParams` needs a Suspense boundary. */
export default function AuditPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the audit log…" />}>
      <AuditScreen />
    </Suspense>
  );
}

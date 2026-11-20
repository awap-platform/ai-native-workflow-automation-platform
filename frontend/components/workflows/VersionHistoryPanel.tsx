"use client";

import { useMemo, useState } from "react";

import {
  compareDefinitionVersions,
  latestComparable,
  rollbackCandidates,
  type WorkflowVersionSnapshot,
} from "../../lib/workflowVersions";

interface VersionHistoryPanelProps {
  versions: WorkflowVersionSnapshot[];
  onRollback: (version: number) => void;
  onArchive: (version: number) => void;
  busy?: boolean;
}

function versionLabel(version: WorkflowVersionSnapshot): string {
  const flags = [
    version.current ? "current" : null,
    version.status.toLowerCase(),
    version.archived ? "archived" : null,
  ].filter((flag): flag is string => flag !== null);
  return `Version ${version.version} (${flags.join(", ")})`;
}

/**
 * Version comparison, rollback and archive (phase 5). Comparison is client-side over the snapshot
 * JSON the backend already returns, so switching versions never issues an extra request.
 */
export default function VersionHistoryPanel({
  versions,
  onRollback,
  onArchive,
  busy = false,
}: VersionHistoryPanelProps) {
  const [fromSelection, setFromSelection] = useState<number | null>(null);
  const [toSelection, setToSelection] = useState<number | null>(null);
  const latest = latestComparable(versions);
  const fromVersion = fromSelection ?? latest?.version ?? null;
  const toVersion =
    toSelection ??
    versions.find((version) => version.version !== fromVersion)?.version ??
    fromVersion;

  const from = versions.find((version) => version.version === fromVersion) ?? null;
  const to = versions.find((version) => version.version === toVersion) ?? null;
  const diff = useMemo(
    () => (from && to ? compareDefinitionVersions(from.definitionJson, to.definitionJson) : null),
    [from, to],
  );
  const candidates = rollbackCandidates(versions);

  if (versions.length === 0) {
    return (
      <section
        className="awap-designer__panel"
        data-testid="version-history"
        aria-labelledby="version-history-heading"
      >
        <h2 id="version-history-heading">Versions</h2>
        <p className="awap-designer__hint">
          Save the draft to create the first version. Version history appears here after a save.
        </p>
      </section>
    );
  }

  return (
    <section
      className="awap-designer__panel"
      data-testid="version-history"
      aria-labelledby="version-history-heading"
    >
      <h2 id="version-history-heading">Versions</h2>
      <div className="awap-designer__row">
        <label className="awap-designer__field">
          Compare from
          <select
            aria-label="Compare from version"
            value={fromVersion ?? ""}
            onChange={(event) => setFromSelection(Number(event.target.value))}
          >
            {versions.map((version) => (
              <option key={version.version} value={version.version}>
                {versionLabel(version)}
              </option>
            ))}
          </select>
        </label>
        <label className="awap-designer__field">
          Compare to
          <select
            aria-label="Compare to version"
            value={toVersion ?? ""}
            onChange={(event) => setToSelection(Number(event.target.value))}
          >
            {versions.map((version) => (
              <option key={version.version} value={version.version}>
                {versionLabel(version)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {diff ? (
        <div data-testid="version-diff">
          <h3>What changed</h3>
          <ul>
            {diff.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {diff.nodesChanged.length > 0 ? (
            <p className="awap-designer__hint">
              Changed nodes: {diff.nodesChanged.join(", ")}
            </p>
          ) : null}
          {diff.transitionsChanged.length > 0 ? (
            <p className="awap-designer__hint">
              Changed transitions: {diff.transitionsChanged.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <h3>History</h3>
      <ul className="awap-designer__version-list">
        {versions.map((version) => (
          <li
            key={version.version}
            className="awap-designer__version"
            data-current={version.current}
          >
            <p>{versionLabel(version)}</p>
            <div className="awap-designer__row">
              <button
                type="button"
                aria-label={`Rollback to version ${version.version}`}
                disabled={busy || version.current || version.archived || version.status !== "PUBLISHED"}
                onClick={() => onRollback(version.version)}
              >
                Rollback
              </button>
              <button
                type="button"
                aria-label={`Archive version ${version.version}`}
                disabled={busy || version.current || version.archived}
                onClick={() => onArchive(version.version)}
              >
                Archive
              </button>
            </div>
          </li>
        ))}
      </ul>
      {candidates.length === 0 ? (
        <p className="awap-designer__hint">
          No other published version is available for rollback.
        </p>
      ) : null}
    </section>
  );
}

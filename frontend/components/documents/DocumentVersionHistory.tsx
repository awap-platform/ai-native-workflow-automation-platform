"use client";

import { useState } from "react";
import type { DocumentVersionDto } from "../../lib/api";
import { scanStatusLabel } from "../../lib/documentScanStatus";
import { formatUtcDateTime } from "../../lib/format";
import { useDocumentVersions } from "../../lib/hooks/resources";

export interface DocumentVersionHistoryProps {
  document: DocumentVersionDto;
}

/** Collapsible, lazily fetched version list for one document. */
export default function DocumentVersionHistory({ document }: DocumentVersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const versions = useDocumentVersions(document.fileId, open);
  const items = versions.data ?? [];

  return (
    <div className="awap-stack">
      <button
        type="button"
        className="awap-button awap-button-ghost"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Hide versions" : "Show versions"}
      </button>
      {open ? (
        <div data-testid={`version-history-${document.fileId}`}>
          {versions.isLoading ? <p role="status">Loading versions…</p> : null}
          {versions.isError ? (
            <p role="alert" className="awap-error">
              The version history could not be loaded.
            </p>
          ) : null}
          {versions.isSuccess && items.length === 0 ? (
            <p className="awap-muted">No versions recorded yet.</p>
          ) : null}
          {items.length > 0 ? (
            <div className="awap-table-wrap">
              <table className="awap-table" aria-label={`Version history for ${document.name ?? document.fileId}`}>
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Size</th>
                    <th scope="col">Lifecycle</th>
                    <th scope="col">Scan</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((version) => (
                    <tr key={version.id} data-testid={`version-row-${version.id}`}>
                      <td>v{version.version}</td>
                      <td>{Math.round(version.size / 1024)} KB</td>
                      <td>{version.status}</td>
                      <td>{scanStatusLabel(version.scanStatus)}</td>
                      <td>{formatUtcDateTime(version.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { Fragment } from "react";
import type { DocumentVersionDto } from "../../lib/api";
import {
  isDocumentDownloadable,
  scanStatusLabel,
  type DocumentScanStatusEventDto,
} from "../../lib/documentScanStatus";
import DocumentScanTimeline from "./DocumentScanTimeline";
import DocumentVersionHistory from "./DocumentVersionHistory";

export interface DocumentScanTableProps {
  documents: DocumentVersionDto[];
  archivePending: boolean;
  onDownload: (document: DocumentVersionDto) => void;
  onArchive: (document: DocumentVersionDto) => void;
  onRetry?: (document: DocumentVersionDto) => void;
  retryPendingFileId?: string | null;
  eventsByFileId?: Record<string, DocumentScanStatusEventDto[]>;
}

/**
 * Document rows with the live antivirus scan status, a session timeline and a version history.
 *
 * <p>Download stays disabled until the row reaches PROMOTED, so stale UI can never hand out a URL
 * for a quarantined, infected or not-yet-promoted file. A SCAN_FAILED row exposes an explicit
 * re-queue action; infected rows are terminal and explain that the file is blocked.
 */
export default function DocumentScanTable({
  documents,
  archivePending,
  onDownload,
  onArchive,
  onRetry,
  retryPendingFileId,
  eventsByFileId = {},
}: DocumentScanTableProps) {
  return (
    <div className="awap-table-wrap">
      <table className="awap-table" aria-label="Documents">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Version</th>
            <th scope="col">Size</th>
            <th scope="col">Scan status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const downloadable = isDocumentDownloadable(document);
            const status = document.scanStatus;
            const name = document.name ?? document.fileId;
            const archived = document.status === "ARCHIVED";
            return (
              <Fragment key={document.id}>
                <tr data-testid={`document-row-${document.fileId}`}>
                  <th scope="row" className="font-mono text-xs">
                    {name}
                  </th>
                  <td>v{document.version}</td>
                  <td>{Math.round(document.size / 1024)} KB</td>
                  <td>
                    <span data-testid={`scan-status-${document.fileId}`}>
                      {scanStatusLabel(status)}
                    </span>
                    {status === "SCAN_FAILED" && document.scanError ? (
                      <div className="awap-danger-text text-xs">{document.scanError}</div>
                    ) : null}
                    {status === "SCAN_FAILED" ? (
                      <div className="awap-warning-text text-xs">
                        Automatic retry is scheduled while attempts remain.
                      </div>
                    ) : null}
                    {status === "INFECTED" ? (
                      <div className="awap-danger-text text-xs">
                        Blocked — antivirus scanning rejected this file.
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className="awap-inline">
                      <button
                        type="button"
                        className="awap-button"
                        disabled={!downloadable}
                        title={
                          downloadable
                            ? "Download the promoted file"
                            : "Available only after the antivirus scan promotes the file"
                        }
                        onClick={() => onDownload(document)}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        className="awap-button"
                        disabled={archivePending || archived}
                        onClick={() => onArchive(document)}
                      >
                        {archived ? "Archived" : "Archive"}
                      </button>
                      {status === "SCAN_FAILED" && onRetry ? (
                        <button
                          type="button"
                          className="awap-button awap-button-primary"
                          disabled={retryPendingFileId === document.fileId}
                          onClick={() => onRetry(document)}
                          aria-label={`Retry scan for ${name}`}
                        >
                          Retry scan
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                <tr data-testid={`document-details-${document.fileId}`}>
                  <td colSpan={5}>
                    <div className="awap-stack">
                      <DocumentScanTimeline
                        document={document}
                        events={eventsByFileId[document.fileId] ?? []}
                      />
                      <DocumentVersionHistory document={document} />
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
          {documents.length === 0 ? (
            <tr>
              <td colSpan={5} className="awap-muted">
                No documents yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { useState } from "react";
import DocumentScanTable from "../../../components/documents/DocumentScanTable";
import UploadDropzone from "../../../components/documents/UploadDropzone";
import { EmptyState, ErrorState, LoadingState } from "../../../components/ui/QueryState";
import type { DocumentVersionDto } from "../../../lib/api";
import {
  infectionMessage,
  isDocumentDownloadable,
  scanStatusAnnouncement,
  scanStatusLabel,
} from "../../../lib/documentScanStatus";
import { useDocumentScanStatus } from "../../../lib/hooks/useDocumentScanStatus";
import {
  useArchiveDocument,
  useDocumentDownloadUrl,
  useDocuments,
  useRetryDocumentScan,
} from "../../../lib/hooks/resources";

export default function DocumentsPage() {
  const [message, setMessage] = useState("");
  const [dismissedInfection, setDismissedInfection] = useState<string | null>(null);
  const { connected, transport, lastEvent, history } = useDocumentScanStatus();
  const documentsQuery = useDocuments();
  const documents = documentsQuery.data ?? [];

  const announcement = lastEvent ? scanStatusAnnouncement(lastEvent) : "";
  const infectedNotice =
    lastEvent?.status === "INFECTED" && dismissedInfection !== lastEvent.occurredAt
      ? infectionMessage(lastEvent)
      : null;

  const archive = useArchiveDocument();
  const downloadUrl = useDocumentDownloadUrl();
  const retry = useRetryDocumentScan();

  async function download(document: DocumentVersionDto) {
    if (!isDocumentDownloadable(document)) {
      return;
    }
    setMessage("");
    try {
      const { downloadUrl: url } = await downloadUrl.mutateAsync(document.fileId);
      window.location.assign(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The download link could not be created.");
    }
  }

  return (
    <div className="awap-page">
      <header className="awap-stack">
        <h1 className="awap-page-title">Documents</h1>
        <p className="awap-muted m-0">
          Uploads are limited to 500 MB and PDF, DOCX, XLSX, PPTX, PNG, JPG and TXT. A file is only
          downloadable after the antivirus scan clears and promotes it.
        </p>
      </header>

      <p
        data-testid="document-stream-state"
        className={transport === "polling" ? "awap-warning-text m-0" : "awap-muted m-0"}
      >
        {transport === "polling"
          ? "Live updates are unavailable; refreshing status by polling."
          : connected
            ? "Live scan status updates are connected."
            : "Connecting to live scan status updates…"}
      </p>

      <UploadDropzone />

      <p aria-live="polite" aria-atomic="true" role="status" data-testid="document-scan-announcer">
        {announcement}
      </p>

      {message ? (
        <p role="status" aria-live="polite" className="awap-alert m-0">
          {message}
        </p>
      ) : null}

      {infectedNotice ? (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="document-infected-alert"
          className="awap-alert awap-alert-danger awap-inline"
        >
          <strong>Infected file blocked.</strong>
          <span>{infectedNotice}</span>
          <button
            type="button"
            className="awap-button awap-button-ghost"
            onClick={() => setDismissedInfection(lastEvent?.occurredAt ?? null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {documentsQuery.isLoading ? <LoadingState label="Loading documents…" /> : null}
      {documentsQuery.isError ? (
        <ErrorState error={documentsQuery.error} message="Failed to load documents." />
      ) : null}
      {documentsQuery.isSuccess && documents.length === 0 ? (
        <EmptyState message="No documents uploaded yet." />
      ) : null}
      {documents.length > 0 ? (
        <DocumentScanTable
          documents={documents}
          archivePending={archive.isPending}
          eventsByFileId={history}
          onDownload={download}
          onArchive={(document) =>
            archive.mutate(document.id, {
              onSuccess: () => setMessage("Version archived."),
              onError: () => setMessage("Archive failed."),
            })
          }
          onRetry={(document) =>
            retry.mutate(document.fileId, {
              onSuccess: (result) =>
                setMessage(
                  `Retry queued for ${document.name ?? document.fileId}. Status: ${scanStatusLabel(
                    result.scanStatus,
                  )}.`,
                ),
              onError: (error) =>
                setMessage(error instanceof Error ? error.message : "The scan could not be retried."),
            })
          }
          retryPendingFileId={retry.isPending ? (retry.variables ?? null) : null}
        />
      ) : null}
    </div>
  );
}

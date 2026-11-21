"use client";

import { useState } from "react";

import { getDocumentDownloadUrl } from "../../lib/api";
import { scanStatusLabel } from "../../lib/documentScanStatus";

export interface FormAttachmentProps {
  fileId: string;
  name: string;
  /** Antivirus lifecycle of the file; only PROMOTED may be downloaded. */
  scanStatus: string | null;
  size?: number | undefined;
  /** Injectable for tests; defaults to the tenant-scoped download endpoint. */
  downloader?: (fileId: string) => Promise<{ downloadUrl: string }>;
  /** Injectable for tests; defaults to a new tab. */
  open?: (url: string) => void;
}

function defaultOpen(url: string): void {
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Scan-gated attachment (T6-05/T6-06): a PROMOTED file offers a download, an
 * INFECTED file is blocked with an explanation and never calls the download
 * endpoint. Statuses that are still moving (QUARANTINED, SCANNING, CLEAN) are
 * disabled until promotion.
 */
export default function FormAttachment({
  fileId,
  name,
  scanStatus,
  size,
  downloader = getDocumentDownloadUrl,
  open = defaultOpen,
}: FormAttachmentProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const promoted = scanStatus === "PROMOTED";
  const infected = scanStatus === "INFECTED";

  async function handleDownload() {
    if (!promoted) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await downloader(fileId);
      open(result.downloadUrl);
    } catch {
      setError("The download link could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="awap-form__attachment" data-scan-status={scanStatus ?? "unknown"}>
      <p className="awap-form__attachment-name">
        {name}
        {typeof size === "number" ? ` · ${Math.ceil(size / 1024)} KB` : ""}
      </p>
      <p className="awap-form__attachment-status">Scan status: {scanStatusLabel(scanStatus)}</p>
      {infected ? (
        <p className="awap-form__error" role="alert">
          Blocked: the file failed the antivirus scan and cannot be downloaded.
        </p>
      ) : null}
      <button
        type="button"
        className="awap-form__attachment-download"
        disabled={!promoted || busy || infected}
        aria-disabled={!promoted || busy}
        onClick={handleDownload}
      >
        {busy ? "Preparing download…" : promoted ? `Download ${name}` : "Download unavailable"}
      </button>
      {!promoted && !infected ? (
        <p className="awap-form__hint">The file becomes downloadable once scanning promotes it.</p>
      ) : null}
      {error ? (
        <p className="awap-form__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

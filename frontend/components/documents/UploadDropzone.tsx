"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES } from "../../lib/documentUpload";
import { useDocumentUpload } from "../../lib/hooks/useDocumentUpload";

export interface UploadDropzoneProps {
  /** Optional callback fired after the bytes reached the quarantine bucket. */
  onUploaded?: () => void;
}

const ACCEPT = DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/**
 * Upload dropzone with a real XHR progress bar and an abort button.
 *
 * <p>Both a cancelled transfer and a failed transfer remove the pending document version created by
 * the presign call, so an interrupted upload never leaves a ghost row in the scan table.
 */
export default function UploadDropzone({ onUploaded }: UploadDropzoneProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useDocumentUpload();
  const notified = useRef(false);

  useEffect(() => {
    if (upload.phase === "complete" && upload.result && !notified.current) {
      notified.current = true;
      onUploaded?.();
    }
    if (upload.phase === "idle" || upload.phase === "uploading") {
      notified.current = false;
    }
  }, [onUploaded, upload.phase, upload.result]);

  const start = (file: File | undefined) => {
    if (!file) {
      return;
    }
    upload.upload(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    start(event.dataTransfer.files?.[0]);
  };

  return (
    <section className="awap-card awap-stack" aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`} className="awap-section-title">
        Upload a document
      </h2>
      <div
        className={`awap-dropzone ${dragging ? "awap-dropzone-active" : ""}`}
        data-testid="upload-dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="m-0">
          Drag a file here, or choose one. Maximum {Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))}{" "}
          MB; allowed formats: {DOCUMENT_EXTENSIONS.join(", ").toUpperCase()}.
        </p>
        <label htmlFor={inputId} className="awap-button">
          Choose file
        </label>
        <input
          id={inputId}
          ref={input}
          type="file"
          className="sr-only"
          aria-label="Upload a document"
          accept={ACCEPT}
          disabled={upload.phase === "uploading"}
          onChange={(event) => {
            start(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {upload.phase === "uploading" ? (
        <div className="awap-stack">
          <progress
            className="awap-progress"
            data-testid="upload-progress"
            aria-label={`Upload progress for ${upload.fileName}`}
            value={upload.percent}
            max={100}
          />
          <div className="awap-inline">
            <span role="status" aria-live="polite" data-testid="upload-progress-text">
              Uploading {upload.fileName} — {upload.percent}%
            </span>
            <button
              type="button"
              className="awap-button awap-button-danger"
              onClick={upload.cancel}
              aria-label="Cancel upload"
            >
              Cancel upload
            </button>
          </div>
        </div>
      ) : null}

      {upload.phase === "complete" ? (
        <p role="status" aria-live="polite" className="m-0">
          {upload.message}
          {upload.result ? (
            <span className="awap-muted"> Pending version {upload.result.version.version}.</span>
          ) : null}
        </p>
      ) : null}

      {upload.phase === "cancelled" ? (
        <p role="status" aria-live="polite" className="awap-warning-text m-0" data-testid="upload-cleanup">
          {upload.message}
        </p>
      ) : null}

      {upload.phase === "error" ? (
        <p role="alert" className="awap-alert awap-alert-danger m-0" data-testid="upload-error">
          {upload.error}
        </p>
      ) : null}

      {upload.phase === "complete" && upload.result ? (
        <button type="button" className="awap-button" onClick={upload.reset}>
          Upload another file
        </button>
      ) : null}
    </section>
  );
}

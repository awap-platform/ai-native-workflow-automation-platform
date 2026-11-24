"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { uploadDocument, UploadCancelledError, UploadValidationError } from "../documentUpload";
import {
  MULTIPART_THRESHOLD_BYTES,
  cancelResumable,
  createMultipartApi,
  uploadResumable,
} from "../multipartUpload";
import { queryKeys } from "../queryKeys";

export type DocumentUploadPhase =
  | "idle"
  | "uploading"
  | "paused"
  | "complete"
  | "cancelled"
  | "error";

export interface DocumentUploadResult {
  fileId: string;
  /** Null when the server did not return a version number. */
  versionNumber: number | null;
}

export interface DocumentUploadState {
  phase: DocumentUploadPhase;
  percent: number;
  fileName: string;
  message: string;
  error: string;
  result: DocumentUploadResult | null;
}

const INITIAL: DocumentUploadState = {
  phase: "idle",
  percent: 0,
  fileName: "",
  message: "",
  error: "",
  result: null,
};

export interface UseDocumentUploadOptions {
  /** Files at or above this size use the resumable protocol (issue #372). */
  multipartThresholdBytes?: number;
  /** Kill switch that keeps every file on the single-PUT path. */
  enableMultipart?: boolean;
}

/**
 * Dropzone controller.
 *
 * <p>Small files keep the single presigned PUT. Larger files use the resumable protocol: the bytes
 * are sent in parts with a per-part retry, the uploadId is persisted so a reload can continue where
 * it stopped, and pausing keeps that state while cancel aborts the upload server-side.
 */
export function useDocumentUpload(options: UseDocumentUploadOptions = {}) {
  const queryClient = useQueryClient();
  const threshold = options.multipartThresholdBytes ?? MULTIPART_THRESHOLD_BYTES;
  const multipartEnabled = options.enableMultipart ?? true;
  const [state, setState] = useState<DocumentUploadState>(INITIAL);
  const controller = useRef<AbortController | null>(null);
  const lastFile = useRef<File | null>(null);
  const paused = useRef(false);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      // Leaving the page terminates the transfer; the resume state stays for the next visit.
      controller.current?.abort();
    },
    [],
  );

  const runSinglePut = useCallback(
    (file: File, signal: AbortSignal) =>
      uploadDocument(
        file,
        (percent) => {
          if (mounted.current) {
            setState((current) => ({ ...current, percent }));
          }
        },
        signal,
      ).then((response) => ({
        fileId: response.fileId,
        versionNumber: response.version?.version ?? null,
      })),
    [],
  );

  const runMultipart = useCallback(
    (file: File, signal: AbortSignal) =>
      uploadResumable(file, createMultipartApi(), {
        signal,
        onProgress: (percent) => {
          if (mounted.current) {
            setState((current) => ({ ...current, percent }));
          }
        },
      }).then((outcome) => ({ fileId: outcome.fileId, versionNumber: null })),
    [],
  );

  const start = useCallback(
    (file: File, resumePercent = 0) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      lastFile.current = file;
      setState({
        phase: "uploading",
        percent: resumePercent,
        fileName: file.name,
        message: "",
        error: "",
        result: null,
      });
      const chunked = multipartEnabled && file.size >= threshold;
      const work = chunked ? runMultipart(file, abort.signal) : runSinglePut(file, abort.signal);
      void work
        .then((result) => {
          if (!mounted.current) {
            return;
          }
          setState({
            phase: "complete",
            percent: 100,
            fileName: file.name,
            message: chunked
              ? "Uploaded in verified parts. Scan status updates live as soon as the antivirus run completes."
              : "Uploaded. Scan status updates live as soon as the antivirus run completes.",
            error: "",
            result,
          });
          void queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
        })
        .catch((error: unknown) => {
          if (!mounted.current) {
            return;
          }
          if (error instanceof UploadCancelledError) {
            if (paused.current) {
              setState((current) => ({
                ...current,
                phase: "paused",
                message: "Upload paused. Resume continues from the last acknowledged part.",
                error: "",
              }));
              return;
            }
            setState({
              phase: "cancelled",
              percent: 0,
              fileName: file.name,
              message: error.cleanupSucceeded
                ? "Upload cancelled. The pending document version was removed."
                : "Upload cancelled, but the pending document version could not be removed.",
              error: "",
              result: null,
            });
            void queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
            return;
          }
          setState({
            phase: "error",
            percent: 0,
            fileName: file.name,
            message: "",
            error:
              error instanceof UploadValidationError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "Upload failed.",
            result: null,
          });
        });
    },
    [multipartEnabled, queryClient, runMultipart, runSinglePut, threshold],
  );

  const upload = useCallback(
    (file: File) => {
      paused.current = false;
      start(file);
    },
    [start],
  );

  /** Stops the in-flight request but keeps the uploadId so a resume can continue it. */
  const pause = useCallback(() => {
    paused.current = true;
    controller.current?.abort();
  }, []);

  const resume = useCallback(() => {
    const file = lastFile.current;
    if (!file) {
      return;
    }
    paused.current = false;
    start(file, state.percent);
  }, [start, state.percent]);

  const cancel = useCallback(() => {
    paused.current = false;
    controller.current?.abort();
    const file = lastFile.current;
    if (file) {
      void cancelResumable(file, createMultipartApi()).catch(() => undefined);
    }
    setState({
      phase: "cancelled",
      percent: 0,
      fileName: file?.name ?? "",
      message: "Upload cancelled. Any staged parts were removed.",
      error: "",
      result: null,
    });
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, upload, pause, resume, cancel, reset };
}

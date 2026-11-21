"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateDocumentResponseDto } from "../api";
import {
  uploadDocument,
  UploadCancelledError,
  UploadValidationError,
} from "../documentUpload";
import { queryKeys } from "../queryKeys";

export type DocumentUploadPhase =
  | "idle"
  | "uploading"
  | "complete"
  | "cancelled"
  | "error";

export interface DocumentUploadState {
  phase: DocumentUploadPhase;
  percent: number;
  fileName: string;
  message: string;
  error: string;
  result: CreateDocumentResponseDto | null;
}

const INITIAL: DocumentUploadState = {
  phase: "idle",
  percent: 0,
  fileName: "",
  message: "",
  error: "",
  result: null,
};

/**
 * Dropzone controller: XHR progress, abort, and an interrupted-upload cleanup.
 *
 * <p>Aborting is two-sided. The in-flight PUT is terminated, and the pending version row created
 * before the PUT is soft-deleted. The hook reports whether that cleanup succeeded instead of always
 * claiming success, because a failed delete leaves a ghost row the user must see.
 */
export function useDocumentUpload() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<DocumentUploadState>(INITIAL);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      // Leaving the page mid-transfer terminates the PUT and removes the pending version.
      controller.current?.abort();
    },
    [],
  );

  const upload = useCallback(
    (file: File) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setState({
        phase: "uploading",
        percent: 0,
        fileName: file.name,
        message: "",
        error: "",
        result: null,
      });
      void uploadDocument(file, (percent) => {
        if (mounted.current) {
          setState((current) => ({ ...current, percent }));
        }
      }, abort.signal)
        .then((result) => {
          if (!mounted.current) {
            return;
          }
          setState({
            phase: "complete",
            percent: 100,
            fileName: file.name,
            message: "Uploaded. Scan status updates live as soon as the antivirus run completes.",
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
    [queryClient],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, upload, cancel, reset };
}

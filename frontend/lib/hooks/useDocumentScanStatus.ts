"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { documentScanEventsUrl, listDocuments, type DocumentVersionDto } from "../api";
import {
  applyScanStatusEvent,
  removeDocumentByFileId,
  type DocumentScanStatusEventDto,
} from "../documentScanStatus";

import { queryKeys } from "../queryKeys";

/** Shared React Query cache key for the document list (same key as the list query). */
export const DOCUMENTS_QUERY_KEY = queryKeys.documents.all;

export interface UseDocumentScanStatusOptions {
  enabled?: boolean;
  /** Polling interval used when SSE is unsupported or exhausted its reconnect budget. */
  pollIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export interface DocumentScanStatusState {
  connected: boolean;
  transport: "sse" | "polling";
  lastEvent: DocumentScanStatusEventDto | null;
  /**
   * Status events observed during this page session, grouped by file id. The backend does not expose
   * a scan-event history endpoint, so the timeline is explicitly session-scoped: after a reload the
   * current status is still shown, but earlier transitions are gone.
   */
  history: Record<string, DocumentScanStatusEventDto[]>;
}

const MAX_EVENTS_PER_FILE = 50;

/**
 * Subscribes to the tenant-scoped document scan SSE stream and applies each event to the document
 * list in place. When EventSource is unavailable (or reconnects are exhausted) it falls back to
 * polling, and visibility changes close/reopen the stream so background tabs do not hold
 * connections. Every path converges on the same React Query cache update.
 */
export function useDocumentScanStatus(
  options: UseDocumentScanStatusOptions = {},
): DocumentScanStatusState {
  const { enabled = true, pollIntervalMs = 5000, maxReconnectAttempts = 5 } = options;
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState<"sse" | "polling">("sse");
  const [lastEvent, setLastEvent] = useState<DocumentScanStatusEventDto | null>(null);
  const [history, setHistory] = useState<Record<string, DocumentScanStatusEventDto[]>>({});
  const mounted = useRef(true);

  const applyEvent = useCallback(
    (event: DocumentScanStatusEventDto) => {
      if (!mounted.current) {
        return;
      }
      setLastEvent(event);
      setHistory((current) => {
        const previous = current[event.fileId] ?? [];
        const duplicate = previous.some(
          (item) =>
            item.status === event.status &&
            item.occurredAt === event.occurredAt &&
            item.detail === event.detail,
        );
        if (duplicate) {
          return current;
        }
        const next = [...previous, event].slice(-MAX_EVENTS_PER_FILE);
        return { ...current, [event.fileId]: next };
      });
      queryClient.setQueryData<DocumentVersionDto[]>(DOCUMENTS_QUERY_KEY, (documents) =>
        applyScanStatusEvent(documents, event),
      );
    },
    [queryClient],
  );

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      return () => {
        mounted.current = false;
      };
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    let disposed = false;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (pollTimer || disposed) {
        return;
      }
      setTransport("polling");
      setConnected(false);
      const poll = () => {
        void queryClient
          .fetchQuery({
            queryKey: DOCUMENTS_QUERY_KEY,
            queryFn: listDocuments,
            staleTime: 0,
          })
          .catch(() => undefined);
      };
      poll();
      pollTimer = setInterval(poll, pollIntervalMs);
    };

    const connect = () => {
      if (disposed || source) {
        return;
      }
      if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
        startPolling();
        return;
      }
      try {
        source = new window.EventSource(documentScanEventsUrl(), { withCredentials: true });
      } catch {
        startPolling();
        return;
      }
      const eventSource = source;
      eventSource.onopen = () => {
        attempts = 0;
        setConnected(true);
        setTransport("sse");
        stopPolling();
      };
      eventSource.addEventListener("scan-status", (message) => {
        try {
          const event = JSON.parse(
            String((message as MessageEvent).data),
          ) as DocumentScanStatusEventDto;
          if (event?.fileId && event?.status) {
            applyEvent(event);
          }
        } catch {
          // A malformed event must not tear down an otherwise healthy stream.
        }
      });
      eventSource.addEventListener("document-deleted", (message) => {
        try {
          const deleted = JSON.parse(String((message as MessageEvent).data)) as {
            fileId?: string;
          };
          if (deleted?.fileId) {
            queryClient.setQueryData<DocumentVersionDto[]>(DOCUMENTS_QUERY_KEY, (documents) =>
              removeDocumentByFileId(documents, deleted.fileId!),
            );
          }
        } catch {
          // Ignore malformed deletion events; the next list/poll reconciles the table.
        }
      });
      eventSource.onerror = () => {
        eventSource.close();
        source = null;
        setConnected(false);
        if (disposed) {
          return;
        }
        attempts += 1;
        if (attempts > maxReconnectAttempts) {
          startPolling();
          return;
        }
        const delay = Math.min(30_000, 1000 * 2 ** (attempts - 1));
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delay);
      };
    };

    const closeStream = () => {
      clearReconnect();
      stopPolling();
      if (source) {
        source.close();
        source = null;
      }
      setConnected(false);
    };

    const onVisibilityChange = () => {
      if (typeof document === "undefined") {
        return;
      }
      if (document.visibilityState === "hidden") {
        closeStream();
      } else {
        connect();
      }
    };

    connect();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      disposed = true;
      mounted.current = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      closeStream();
    };
  }, [applyEvent, enabled, maxReconnectAttempts, pollIntervalMs, queryClient]);

  return { connected, transport, lastEvent, history };
}

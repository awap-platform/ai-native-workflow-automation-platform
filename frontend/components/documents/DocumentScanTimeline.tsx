"use client";

import type { DocumentVersionDto } from "../../lib/api";
import {
  scanStatusLabel,
  type DocumentScanStatusEventDto,
} from "../../lib/documentScanStatus";
import { formatUtcDateTime } from "../../lib/format";

export interface DocumentScanTimelineProps {
  document: DocumentVersionDto;
  events: DocumentScanStatusEventDto[];
}

function isDanger(status: string): boolean {
  return status === "INFECTED" || status === "SCAN_FAILED";
}

/**
 * Session-observed antivirus timeline for one file.
 *
 * <p>The SSE stream is the only source of scan transitions the UI receives; the backend does not
 * expose a persisted scan-event history endpoint, so this list starts empty after a reload. The
 * current scan status is always present, which keeps the timeline truthful even when no event was
 * observed by this tab.
 */
export default function DocumentScanTimeline({ document, events }: DocumentScanTimelineProps) {
  const name = document.name ?? document.fileId;
  const items: DocumentScanStatusEventDto[] =
    events.length > 0
      ? events
      : [
          {
            tenantId: "",
            fileId: document.fileId,
            name,
            status: (document.scanStatus ?? "QUARANTINED") as DocumentScanStatusEventDto["status"],
            detail: document.scanError ?? "",
            occurredAt: document.createdAt,
          },
        ];

  return (
    <ol
      className="awap-timeline"
      aria-label={`Scan timeline for ${name}`}
      data-testid={`scan-timeline-${document.fileId}`}
    >
      {items.map((event, index) => (
        <li
          key={`${event.occurredAt}-${event.status}-${index}`}
          className="awap-timeline-item"
          data-terminal={event.status === "PROMOTED" ? "true" : "false"}
          data-danger={isDanger(event.status) ? "true" : "false"}
        >
          <span className="awap-timeline-status">{scanStatusLabel(event.status)}</span>
          <span className="awap-muted">{formatUtcDateTime(event.occurredAt)}</span>
          {event.detail ? <span>{event.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

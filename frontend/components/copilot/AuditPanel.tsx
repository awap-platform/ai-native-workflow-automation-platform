"use client";

import { Badge } from "../ui/surface";
import type { CopilotAuditEntry } from "../../lib/copilot";

/** Audit view of tool calls and decisions, one deduplicated entry per logical request. */
export function AuditPanel({ entries }: { entries: CopilotAuditEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <details data-testid="copilot-audit" className="awap-card">
      <summary className="cursor-pointer awap-section-title">
        Audit trail ({entries.length} request{entries.length === 1 ? "" : "s"})
      </summary>
      <p className="awap-text-xs awap-muted mt-2">
        One entry per request key. Replaying the same key does not add a duplicate entry.
      </p>
      <ol className="awap-list mt-3 grid gap-3">
        {entries.map((entry) => (
          <li key={entry.requestId} data-testid="copilot-audit-entry" className="awap-card">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">{entry.action}</Badge>
              <span className="awap-text-sm">{entry.outcome ?? "UNKNOWN"}</span>
              <span className="awap-text-xs awap-muted">
                confidence {entry.confidence.toFixed(2)}
              </span>
              {entry.requiresHumanApproval ? <Badge variant="warning">HITL</Badge> : null}
            </div>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 awap-text-xs">
              <dt>Request</dt>
              <dd className="awap-font-mono break-all">{entry.requestId}</dd>
              <dt>Correlation</dt>
              <dd className="awap-font-mono break-all">{entry.correlationId || "n/a"}</dd>
              <dt>Prompt</dt>
              <dd>
                {entry.promptKey || "n/a"} ({entry.promptVersion || "n/a"})
              </dd>
              <dt>Model</dt>
              <dd>{entry.model ?? "n/a"}</dd>
              {entry.decision ? (
                <>
                  <dt>Decision</dt>
                  <dd>{entry.decision}</dd>
                </>
              ) : null}
              {entry.proposalHash ? (
                <>
                  <dt>Proposal hash</dt>
                  <dd className="awap-font-mono break-all">{entry.proposalHash}</dd>
                </>
              ) : null}
            </dl>
            <ul className="mt-2 grid gap-1 awap-text-xs">
              {entry.toolCalls.map((call, index) => (
                <li key={`${call.name}-${index}`} className="flex flex-wrap items-center gap-2">
                  <span className="awap-font-mono">{call.name}</span>
                  <Badge variant={call.ok ? "success" : "danger"}>
                    {call.ok ? "ok" : "failed"}
                  </Badge>
                  {call.error ? <span className="awap-danger-text">{call.error}</span> : null}
                </li>
              ))}
              {entry.toolCalls.length === 0 ? <li>No tool calls.</li> : null}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  );
}

"use client";

import { Badge } from "../ui/surface";
import { redactArguments, toolCallStatus } from "../../lib/copilot";
import type { CopilotToolCallDto } from "../../lib/api";

/** One executed tool call with its status and redacted arguments. */
export function ToolCallCard({ call }: { call: CopilotToolCallDto }) {
  const status = toolCallStatus(call);
  const redacted = redactArguments(call.arguments);
  return (
    <li data-testid="copilot-tool-call" data-tool-name={call.name}>
      <details className="awap-card">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
          <span className="awap-font-mono text-sm">{call.name}</span>
          <Badge variant={status === "ok" ? "success" : "danger"}>{status}</Badge>
          {call.error ? <span className="awap-text-xs awap-danger-text">{call.error}</span> : null}
        </summary>
        <div className="mt-2 grid gap-2">
          <p className="awap-text-xs awap-muted">
            Arguments are redacted for sensitive keys and personal data before display.
          </p>
          <pre className="awap-code-block awap-text-xs" aria-label={`${call.name} arguments`}>
            {JSON.stringify(redacted, null, 2)}
          </pre>
        </div>
      </details>
    </li>
  );
}

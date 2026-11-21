"use client";

import { Button } from "../ui/button";
import type { PendingHitl } from "../../lib/hooks/useCopilot";

/**
 * Human-in-the-loop confirmation panel.
 *
 * Rejecting never calls the backend: no approval, task decision or workflow start is sent. Approval
 * reuses the original idempotency key so a double click cannot run the action twice.
 */
export function HitlPanel({
  pending,
  busy,
  onApprove,
  onReject,
}: {
  pending: PendingHitl;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const approval = pending.approvalRequest;
  return (
    <section
      data-testid="copilot-hitl-panel"
      className="awap-card awap-alert-warning"
      aria-labelledby="copilot-hitl-title"
    >
      <h3 id="copilot-hitl-title" className="awap-section-title">
        Human confirmation required
      </h3>
      <p className="awap-reading">{pending.summary}</p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 awap-text-sm">
        <dt>Proposed action</dt>
        <dd data-testid="copilot-hitl-action">
          {pending.proposal?.proposedAction ?? pending.chatRequest?.action ?? "state change"}
        </dd>
        {pending.proposal?.workflowInstanceId ? (
          <>
            <dt>Workflow instance</dt>
            <dd className="awap-font-mono">{pending.proposal.workflowInstanceId}</dd>
          </>
        ) : null}
        {approval ? (
          <>
            <dt>Approval title</dt>
            <dd>{approval.title}</dd>
            {approval.description ? (
              <>
                <dt>Description</dt>
                <dd>{approval.description}</dd>
              </>
            ) : null}
          </>
        ) : null}
        {pending.payloadHash ? (
          <>
            <dt>Payload hash</dt>
            <dd data-testid="copilot-hitl-hash" className="awap-font-mono break-all">
              {pending.payloadHash}
            </dd>
          </>
        ) : null}
        <dt>Idempotency key</dt>
        <dd className="awap-font-mono break-all">{pending.idempotencyKey}</dd>
      </dl>
      <div className="awap-confirm-actions mt-4">
        <Button variant="default" onClick={onApprove} loading={busy} data-testid="copilot-hitl-approve">
          Approve and run
        </Button>
        <Button
          variant="outline"
          onClick={onReject}
          disabled={busy}
          data-testid="copilot-hitl-reject"
        >
          Reject
        </Button>
      </div>
      <p className="awap-text-xs awap-muted mt-2">
        Rejecting sends no action to the backend. Approval reuses this idempotency key, so a replay
        returns the original result instead of creating a second action.
      </p>
    </section>
  );
}

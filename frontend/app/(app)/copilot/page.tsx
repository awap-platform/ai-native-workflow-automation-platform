"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { AuditPanel } from "../../../components/copilot/AuditPanel";
import { BudgetIndicator } from "../../../components/copilot/BudgetIndicator";
import { CopilotMessage } from "../../../components/copilot/CopilotMessage";
import { HitlPanel } from "../../../components/copilot/HitlPanel";
import { SessionSidebar } from "../../../components/copilot/SessionSidebar";
import { SuggestionCards } from "../../../components/copilot/SuggestionCards";
import { Button } from "../../../components/ui/button";
import {
  MAX_MESSAGE_LENGTH,
  auditEntriesFromTurns,
  validateMessage,
} from "../../../lib/copilot";
import { useCopilotConversation, type ApprovalDraft } from "../../../lib/hooks/useCopilot";
import { useActiveTenant } from "../../../lib/hooks/useActiveTenant";

const EMPTY_DRAFT: ApprovalDraft = {
  workflowInstanceId: "",
  title: "",
  description: "",
  assigneeId: "",
};

function subscribeOnline(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function onlineSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export default function CopilotPage() {
  const tenant = useActiveTenant();
  // Remounting by tenant guarantees one tenant's conversation history can never render under
  // another tenant, even for a single frame during a tenant switch.
  return <CopilotWorkspace key={tenant ?? "anonymous"} tenantId={tenant} />;
}

function CopilotWorkspace({ tenantId }: { tenantId: string | null }) {
  const copilot = useCopilotConversation({ tenantId });
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<ApprovalDraft>(EMPTY_DRAFT);
  const { clearError } = copilot;
  const errorKind = copilot.error?.kind;

  useEffect(() => {
    if (errorKind !== "network") {
      return;
    }
    const handleOnline = () => clearError();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [clearError, errorKind]);

  const validation = validateMessage(message);
  const busy = copilot.status !== "idle";
  const auditEntries = useMemo(
    () => auditEntriesFromTurns(copilot.turns),
    [copilot.turns],
  );

  const submit = () => {
    if (!validation.ok || busy) {
      return;
    }
    const text = message;
    setMessage("");
    void copilot.send(text);
  };

  const submitApproval = () => {
    if (busy) {
      return;
    }
    void copilot.proposeApproval(draft);
  };

  return (
    <div className="awap-page" data-testid="copilot-page">
      <div className="awap-card-header">
        <div>
          <h1 className="awap-page-title">AI Copilot</h1>
          <p className="awap-reading awap-muted">
            Ask in natural language to discover or start a workflow, query or decide tasks, send a
            notification, prepare an approval, or search tenant documents. High-risk actions always
            require explicit human confirmation and are audited.
          </p>
        </div>
        <BudgetIndicator budget={copilot.budget} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <SessionSidebar
          sessions={copilot.sessions}
          activeSessionId={copilot.activeSession?.id ?? null}
          onSelect={copilot.selectSession}
          onNew={copilot.newSession}
        />

        <div className="grid gap-3">
          <section className="awap-card" aria-labelledby="copilot-request-heading">
            <h2 id="copilot-request-heading" className="awap-section-title">
              Copilot request
            </h2>
            <label className="awap-label" htmlFor="copilot-message">
              Your request
            </label>
            <textarea
              id="copilot-message"
              className="awap-textarea"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder="For example: find the leave policy, or start a leave request"
              aria-describedby="copilot-message-help"
              aria-invalid={message.length > MAX_MESSAGE_LENGTH}
            />
            <p id="copilot-message-help" className="awap-text-xs awap-muted">
              {message.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()} characters.
              {" "}Oversized messages are rejected before any model or tool call.
            </p>
            {!validation.ok && message.length > 0 ? (
              <p role="alert" className="awap-alert awap-alert-warning">
                {validation.error}
              </p>
            ) : null}
            <div className="awap-toolbar mt-2">
              <Button
                variant="default"
                onClick={submit}
                disabled={busy || !validation.ok}
                loading={copilot.status === "sending"}
                data-testid="copilot-send"
              >
                Send to Copilot
              </Button>
              {busy ? (
                <Button variant="outline" onClick={copilot.cancel} data-testid="copilot-cancel">
                  Cancel response
                </Button>
              ) : null}
              {copilot.error?.retryable ? (
                <Button
                  variant="outline"
                  onClick={() => void copilot.retry()}
                  data-testid="copilot-retry"
                >
                  Retry same request
                </Button>
              ) : null}
            </div>
            <SuggestionCards
              disabled={busy}
              onSelect={(prompt) => {
                if (busy) {
                  return;
                }
                setMessage("");
                void copilot.send(prompt);
              }}
            />
          </section>

          <details className="awap-card">
            <summary className="cursor-pointer awap-section-title">Prepare an approval</summary>
            <p className="awap-text-xs awap-muted mt-2">
              The first step only proposes. Nothing is created until you review the payload hash and
              approve it in the HITL panel.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="awap-label">Workflow instance id</span>
                <input
                  className="awap-input"
                  value={draft.workflowInstanceId}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      workflowInstanceId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1">
                <span className="awap-label">Approval title</span>
                <input
                  className="awap-input"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, title: event.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1 sm:col-span-2">
                <span className="awap-label">Description</span>
                <textarea
                  className="awap-textarea"
                  rows={2}
                  value={draft.description ?? ""}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, description: event.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1">
                <span className="awap-label">Assignee id (optional)</span>
                <input
                  className="awap-input"
                  value={draft.assigneeId ?? ""}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, assigneeId: event.target.value }))
                  }
                />
              </label>
            </div>
            <Button
              className="mt-3"
              variant="outline"
              onClick={submitApproval}
              disabled={busy || !draft.workflowInstanceId.trim() || !draft.title.trim()}
              data-testid="copilot-propose-approval"
            >
              Propose approval
            </Button>
          </details>

          {!online ? (
            <p role="alert" className="awap-alert awap-alert-warning" data-testid="copilot-offline">
              You are offline. Reconnect before sending; the current conversation is kept locally.
            </p>
          ) : null}

          <p role="status" aria-live="polite" className="awap-text-xs awap-muted">
            {copilot.status === "sending"
              ? "Copilot is thinking…"
              : copilot.status === "streaming"
                ? "Copilot is streaming the answer…"
                : copilot.firstTokenMs !== null
                  ? `First token in ${copilot.firstTokenMs} ms.`
                  : ""}
          </p>
          {copilot.firstTokenMs !== null ? (
            <span className="sr-only" data-testid="copilot-first-token">
              {copilot.firstTokenMs}
            </span>
          ) : null}

          {copilot.error ? (
            <div role="alert" className="awap-error" data-testid="copilot-error">
              <p>{copilot.error.message}</p>
              {copilot.error.kind === "budget" && copilot.error.remainingTokens !== undefined ? (
                <p className="awap-text-sm">
                  Remaining AI budget: {copilot.error.remainingTokens.toLocaleString()} tokens.
                </p>
              ) : null}
              {copilot.error.kind === "network" ? (
                <p className="awap-text-sm">
                  The conversation is preserved locally. When the connection returns, retry keeps the
                  same idempotency key, so a replayed request cannot run twice.
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {copilot.error.retryable ? (
                  <Button variant="outline" onClick={() => void copilot.retry()}>
                    Retry
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={copilot.clearError}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}

          <section
            data-testid="copilot-transcript"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Conversation transcript"
            className="grid gap-3"
          >
            {copilot.turns.length === 0 ? (
              <div className="awap-empty">
                <p>
                  Start a conversation or pick a suggestion. Sessions and history stay in this
                  browser, scoped to the active tenant.
                </p>
              </div>
            ) : (
              copilot.turns.map((turn) => <CopilotMessage key={turn.id} turn={turn} />)
            )}
          </section>

          {copilot.pendingHitl ? (
            <HitlPanel
              pending={copilot.pendingHitl}
              busy={busy}
              onApprove={() => void copilot.approvePending()}
              onReject={copilot.rejectPending}
            />
          ) : null}

          <AuditPanel entries={auditEntries} />
        </div>
      </div>
    </div>
  );
}

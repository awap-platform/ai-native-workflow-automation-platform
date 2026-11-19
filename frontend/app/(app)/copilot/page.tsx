"use client";

import { useEffect, useRef, useState } from "react";

import { ErrorState, LoadingState } from "../../../components/ui/QueryState";
import { resolveIntentKey, type CopilotIntent } from "../../../lib/copilotIdempotency";
import { useCopilotChat } from "../../../lib/hooks/useCopilot";

export default function CopilotPage() {
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const intentRef = useRef<CopilotIntent | null>(null);
  const copilot = useCopilotChat();

  // A completed turn is a new intent: the next submit must get a fresh key. A failed turn keeps
  // the key so an explicit retry is replayed instead of creating a second process.
  useEffect(() => {
    if (copilot.isSuccess) {
      intentRef.current = null;
    }
  }, [copilot.isSuccess]);

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed || copilot.isPending) {
      return;
    }
    const intent = resolveIntentKey(intentRef.current, trimmed);
    intentRef.current = intent;
    copilot.mutate({
      message: trimmed,
      confirm_high_risk: confirmed,
      idempotency_key: intent.key,
    });
  };

  const result = copilot.data;

  return (
    <div className="awap-page" data-testid="copilot-page">
      <h1 className="awap-page-title">AI Copilot</h1>
      <p className="awap-reading awap-muted">
        Ask in natural language to discover or start a workflow, query, complete or assign tasks,
        send a notification, prepare an approval, or search your tenant documents. High-risk
        actions require explicit confirmation and are audited.
      </p>

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
          maxLength={8_000}
          placeholder="For example: start a leave request"
        />
        <label className="awap-checkbox-row">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I confirm this high-risk action (start workflow, task decision or approval).
        </label>
        <button
          type="button"
          className="awap-button awap-button-primary"
          onClick={submit}
          disabled={copilot.isPending || message.trim().length === 0}
        >
          {copilot.isPending ? "Thinking…" : "Send to Copilot"}
        </button>
      </section>

      {copilot.isPending ? <LoadingState label="Copilot is working…" /> : null}
      {copilot.isError ? (
        <ErrorState error={copilot.error} message="The Copilot request failed." />
      ) : null}

      {result ? (
        <section className="awap-card" aria-live="polite" aria-labelledby="copilot-answer-heading">
          <h2 id="copilot-answer-heading" className="awap-section-title">
            Answer
          </h2>
          <div data-testid="copilot-answer" className="whitespace-pre-wrap">
            {result.answer}
          </div>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 awap-muted">
            <dt>Intent</dt>
            <dd>{result.action}</dd>
            <dt>Confidence</dt>
            <dd>{result.confidence.toFixed(2)}</dd>
            <dt>Model</dt>
            <dd>
              {result.model ?? "n/a"} ({result.model_tier ?? "n/a"})
            </dd>
            <dt>Prompt version</dt>
            <dd>{result.prompt_version}</dd>
            <dt>Correlation ID</dt>
            <dd>{result.correlation_id || "n/a"}</dd>
          </dl>
          {result.requires_human_approval ? (
            <p
              data-testid="copilot-hitl"
              className="awap-alert awap-alert-warning mt-3"
            >
              Human confirmation is required before this action can run.
            </p>
          ) : null}
          <h3 className="mt-4 awap-section-title">Tool calls</h3>
          <ul data-testid="copilot-tool-calls" className="awap-list pl-4">
            {result.tool_calls.map((call, index) => (
              <li key={`${call.name}-${index}`}>
                <strong>{call.name}</strong> {call.ok ? "ok" : `failed: ${call.error ?? ""}`}
              </li>
            ))}
            {result.tool_calls.length === 0 ? <li>No tool calls.</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

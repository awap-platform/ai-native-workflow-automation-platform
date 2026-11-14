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
    <div data-testid="copilot-page">
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>AI Copilot</h1>
      <p style={{ color: "#475569", maxWidth: 760 }}>
        Ask in natural language to discover or start a workflow, query and complete tasks, prepare
        an approval, or search your tenant documents. High-risk actions require explicit
        confirmation and are audited.
      </p>

      <section
        style={{
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          padding: 16,
          marginTop: 16,
          background: "#f8fafc",
        }}
      >
        <label htmlFor="copilot-message" style={{ display: "block", fontWeight: 600 }}>
          Your request
        </label>
        <textarea
          id="copilot-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          maxLength={8_000}
          placeholder="Örneğin: İzin talebi başlat"
          style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 8 }}
        />
        <label style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I confirm this high-risk action (start workflow, task decision or approval).
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={copilot.isPending || message.trim().length === 0}
          style={{
            marginTop: 12,
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "#4f46e5",
            color: "white",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {copilot.isPending ? "Thinking…" : "Send to Copilot"}
        </button>
      </section>

      {copilot.isPending && <LoadingState label="Copilot is working…" />}
      {copilot.isError && (
        <ErrorState error={copilot.error} message="The Copilot request failed." />
      )}

      {result && (
        <section style={{ marginTop: 20 }} aria-live="polite">
          <h2 style={{ fontSize: 18 }}>Answer</h2>
          <div
            data-testid="copilot-answer"
            style={{
              whiteSpace: "pre-wrap",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: 16,
              background: "white",
            }}
          >
            {result.answer}
          </div>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              gap: "6px 16px",
              marginTop: 12,
              color: "#475569",
            }}
          >
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
          {result.requires_human_approval && (
            <p
              data-testid="copilot-hitl"
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: "#fef3c7",
                color: "#92400e",
              }}
            >
              Human confirmation is required before this action can run.
            </p>
          )}
          <h3 style={{ fontSize: 16, marginTop: 18 }}>Tool calls</h3>
          <ul data-testid="copilot-tool-calls" style={{ paddingLeft: 20 }}>
            {result.tool_calls.map((call, index) => (
              <li key={`${call.name}-${index}`}>
                <strong>{call.name}</strong> {call.ok ? "ok" : `failed: ${call.error ?? ""}`}
              </li>
            ))}
            {result.tool_calls.length === 0 && <li>No tool calls.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}

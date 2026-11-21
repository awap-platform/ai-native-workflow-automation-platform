"use client";

import Link from "next/link";

import { Badge } from "../ui/surface";
import { CitationCard } from "./CitationCard";
import { GuardrailWarnings } from "./GuardrailWarnings";
import { ToolCallCard } from "./ToolCallCard";
import {
  citationsOf,
  isLowConfidence,
  isNoAnswer,
  lacksCitations,
  warningsOf,
  type CopilotTurn,
} from "../../lib/copilot";

/** One user or assistant turn with every Phase 9 assistant surface. */
export function CopilotMessage({ turn }: { turn: CopilotTurn }) {
  if (turn.role === "user") {
    return (
      <article
        data-testid="copilot-user-message"
        className="awap-card ml-auto max-w-[90%] awap-surface-raised"
      >
        <h3 className="awap-text-xs awap-muted">You</h3>
        <p className="whitespace-pre-wrap break-words">{turn.text}</p>
      </article>
    );
  }

  const response = turn.response;
  const noAnswer = response ? isNoAnswer(response) : false;
  const lowConfidence = response ? isLowConfidence(response) : false;
  const missingCitations = response ? lacksCitations(response) : false;
  const citations = response ? citationsOf(response) : [];
  const warnings = response ? warningsOf(response) : [];

  return (
    <article data-testid="copilot-assistant-message" className="awap-card grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="primary">Copilot</Badge>
        {response ? (
          <>
            <Badge variant="muted">{response.action}</Badge>
            <span className="awap-text-xs awap-muted">
              confidence {response.confidence.toFixed(2)}
            </span>
            {response.model ? (
              <span className="awap-text-xs awap-muted">
                {response.model} ({response.model_tier ?? "n/a"})
              </span>
            ) : null}
          </>
        ) : null}
        {turn.status === "streaming" ? (
          <span className="awap-text-xs awap-muted" data-testid="copilot-streaming">
            Streaming…
          </span>
        ) : null}
        {turn.status === "cancelled" ? <Badge variant="warning">Cancelled</Badge> : null}
        {turn.status === "error" ? <Badge variant="danger">Failed</Badge> : null}
      </div>

      {turn.text ? (
        <div
          data-testid="copilot-answer"
          className="whitespace-pre-wrap break-words"
          aria-busy={turn.status === "streaming"}
        >
          {turn.text}
        </div>
      ) : null}

      {response ? (
        <>
          <GuardrailWarnings warnings={warnings} guardrail={response.guardrail} />

          {noAnswer ? (
            <div
              data-testid="copilot-no-answer"
              role="alert"
              className="awap-alert awap-alert-warning"
            >
              <p>
                The Copilot does not know the answer from your tenant documents. It will not guess.
                A human reviewer is required before this request continues.
              </p>
              <Link className="awap-link-button" href="/tasks">
                Open the task inbox to assign a human reviewer
              </Link>
            </div>
          ) : null}

          {lowConfidence ? (
            <div
              data-testid="copilot-low-confidence"
              role="status"
              className="awap-alert awap-alert-warning"
            >
              Confidence is below the configured threshold. Treat this as a suggestion, not a fact,
              and route it through human review before acting.
            </div>
          ) : null}

          {missingCitations ? (
            <p
              data-testid="copilot-missing-citations"
              role="alert"
              className="awap-alert awap-alert-warning"
            >
              This answer has no source citation. Do not treat it as a grounded fact until a source is
              reviewed.
            </p>
          ) : null}

          {citations.length > 0 ? (
            <section aria-labelledby={`citations-${turn.id}`}>
              <h4 id={`citations-${turn.id}`} className="awap-section-title">
                Sources
              </h4>
              <ul data-testid="copilot-citations" className="awap-list grid gap-2">
                {citations.map((citation) => (
                  <CitationCard key={`${citation.document_id}-${citation.chunk_index}`} citation={citation} />
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby={`tools-${turn.id}`}>
            <h4 id={`tools-${turn.id}`} className="awap-section-title">
              Tool calls
            </h4>
            <ul data-testid="copilot-tool-calls" className="awap-list grid gap-2">
              {response.tool_calls.map((call, index) => (
                <ToolCallCard key={`${call.name}-${index}`} call={call} />
              ))}
              {response.tool_calls.length === 0 ? <li>No tool calls.</li> : null}
            </ul>
          </section>
        </>
      ) : null}

      {turn.status === "error" && turn.error ? (
        <p role="alert" className="awap-error" data-testid="copilot-turn-error">
          {turn.error}
        </p>
      ) : null}
    </article>
  );
}

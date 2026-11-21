"use client";

import type { CopilotCitationDto } from "../../lib/api";

/** A structured source reference for a grounded answer. */
export function CitationCard({ citation }: { citation: CopilotCitationDto }) {
  const score =
    citation.score === null || citation.score === undefined
      ? null
      : `score ${citation.score.toFixed(2)}`;
  return (
    <li data-testid="copilot-citation" className="awap-card awap-text-sm">
      <span className="awap-badge" aria-hidden="true">
        [{citation.index}]
      </span>{" "}
      <cite className="font-semibold not-italic">{citation.title}</cite>
      <p className="awap-text-xs awap-muted">
        Document {citation.document_id}, chunk {citation.chunk_index}
        {score ? ` · ${score}` : ""}
      </p>
    </li>
  );
}

"use client";

import { Badge } from "../ui/surface";

export interface CopilotSuggestion {
  id: string;
  label: string;
  prompt: string;
  kind: "tasks" | "knowledge" | "workflow" | "notification";
}

export const DEFAULT_SUGGESTIONS: CopilotSuggestion[] = [
  {
    id: "tasks",
    label: "Show my open tasks",
    prompt: "Show my open tasks",
    kind: "tasks",
  },
  {
    id: "knowledge",
    label: "Find the leave policy",
    prompt: "Find the leave policy in our tenant documents",
    kind: "knowledge",
  },
  {
    id: "workflow",
    label: "Start a leave request",
    prompt: "Start a leave request",
    kind: "workflow",
  },
  {
    id: "notification",
    label: "Notify the approver",
    prompt: "Notify the approver about the pending request",
    kind: "notification",
  },
];

export function SuggestionCards({
  suggestions = DEFAULT_SUGGESTIONS,
  onSelect,
  disabled = false,
}: {
  suggestions?: CopilotSuggestion[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      data-testid="copilot-suggestions"
      className="grid gap-2 sm:grid-cols-2"
      aria-label="Suggested Copilot requests"
    >
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          className="awap-card flex items-start justify-between gap-3 text-left"
          onClick={() => onSelect(suggestion.prompt)}
          disabled={disabled}
          data-testid={`copilot-suggestion-${suggestion.id}`}
        >
          <span className="awap-text-sm">{suggestion.label}</span>
          <Badge variant="muted">{suggestion.kind}</Badge>
        </button>
      ))}
    </div>
  );
}

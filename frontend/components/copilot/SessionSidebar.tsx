"use client";

import { Button } from "../ui/button";
import type { CopilotSession } from "../../lib/copilot";

/** Conversation history and session switching. History is scoped to the active tenant. */
export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
}: {
  sessions: CopilotSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside data-testid="copilot-sessions" className="grid gap-2" aria-label="Conversation history">
      <div className="flex items-center justify-between gap-2">
        <h2 className="awap-section-title">Conversations</h2>
        <Button variant="outline" size="sm" onClick={onNew} data-testid="copilot-new-session">
          New chat
        </Button>
      </div>
      <ul className="awap-list grid gap-1">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          return (
            <li key={session.id}>
              <button
                type="button"
                className={`awap-nav-link w-full text-left ${active ? "awap-badge-active" : ""}`}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(session.id)}
                data-testid="copilot-session"
              >
                <span className="block truncate awap-text-sm">{session.title}</span>
                <span className="block awap-text-xs awap-muted">
                  {session.turns.length} message{session.turns.length === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

import type {
  CopilotHitlDto,
  CopilotSessionDto,
  CopilotSessionThreadDto,
  CopilotTurnDto,
} from "./api";
import { createSession, type CopilotSession, type CopilotTurn } from "./copilot";

/**
 * Deterministic merge between the offline cache and the server (issue #373).
 *
 * <p>The server is the source of truth for hydration, but the local cache may hold drafts that were
 * written while offline. The merge is a union by turn id: a turn that exists on both sides keeps the
 * server copy (it is the one with the hash chain and the redacted content), a local-only turn is
 * appended, and the result is ordered by turn sequence so a session can never render out of order or
 * duplicate a turn on reconnect.
 */
export function mergeTurns(server: CopilotTurn[], local: CopilotTurn[]): CopilotTurn[] {
  const byId = new Map<string, CopilotTurn>();
  for (const turn of server) {
    byId.set(turn.id, turn);
  }
  for (const turn of local) {
    if (!byId.has(turn.id)) {
      byId.set(turn.id, turn);
    }
  }
  return [...byId.values()].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.id.localeCompare(right.id);
  });
}

/** Merges two session lists, keeping the newest copy of every session by id. */
export function mergeSessions(local: CopilotSession[], remote: CopilotSession[]): CopilotSession[] {
  const byId = new Map<string, CopilotSession>();
  for (const session of local) {
    byId.set(session.id, session);
  }
  for (const session of remote) {
    const existing = byId.get(session.id);
    byId.set(
      session.id,
      existing
        ? {
            ...session,
            turns: mergeTurns(session.turns, existing.turns),
            updatedAt: Math.max(session.updatedAt, existing.updatedAt),
          }
        : session,
    );
  }
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Maps a stored turn to the local turn shape; corrupt rows are skipped instead of breaking the view. */
export function toLocalTurn(turn: CopilotTurnDto): CopilotTurn | null {
  if (!turn || typeof turn.id !== "string" || typeof turn.content !== "string") {
    return null;
  }
  const createdAt = Date.parse(turn.createdAt);
  return {
    id: turn.id,
    role: turn.role === "assistant" ? "assistant" : "user",
    text: turn.content,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    requestId: turn.id,
    status: "complete",
  };
}

/** Maps a hydrated thread to the local session shape, dropping turns that cannot be trusted. */
export function toLocalSession(thread: CopilotSessionThreadDto): CopilotSession {
  const turns = thread.turns.map(toLocalTurn).filter((turn): turn is CopilotTurn => turn !== null);
  const createdAt = Date.parse(thread.createdAt);
  const updatedAt = Date.parse(thread.updatedAt);
  return {
    id: thread.id,
    title: thread.title,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    turns,
  };
}

/** Pending approvals recovered from the server, most recent first. */
export function pendingApprovals(thread: CopilotSessionThreadDto): CopilotHitlDto[] {
  return thread.hitl.filter((entry) => entry.state === "PENDING");
}

/** A brand-new local session, used when the server has nothing for this tenant yet. */
export function emptySession(): CopilotSession {
  return createSession();
}

/** True when the server page has no sessions, so the caller keeps the local draft. */
export function isEmptyPage(items: CopilotSessionDto[]): boolean {
  return items.length === 0;
}

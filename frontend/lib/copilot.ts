import {
  ApiError,
  errorStatus,
  type CopilotBudgetDto,
  type CopilotCitationDto,
  type CopilotResponseDto,
  type CopilotToolCallDto,
  type CopilotWarningDto,
} from "./api";

/**
 * Pure Copilot experience helpers shared by the page, the hook and the tests.
 *
 * Everything here is deterministic and side-effect free except the explicitly injected storage
 * functions. Conversation history is tenant-scoped and stored in the browser: the AI layer is
 * stateless, so there is no server-side session record to reconcile (documented limitation).
 */

export const MAX_MESSAGE_LENGTH = 8_000;
export const MAX_REVEAL_CHUNK = 28;
export const SESSIONS_STORAGE_PREFIX = "awap.copilot.sessions.v1";

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|card|iban|email|phone|ssn/i;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE = /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g;
const REDACTED = "[REDACTED]";
const PII_REDACTED = "[PII_REDACTED]";

export type TurnStatus = "streaming" | "complete" | "cancelled" | "error";

export interface CopilotRequestSnapshot {
  message: string;
  idempotencyKey: string;
  confirmHighRisk: boolean;
  action?: string;
  context?: Record<string, unknown>;
}

export interface CopilotTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  requestId: string;
  status: TurnStatus;
  response?: CopilotResponseDto;
  error?: string;
  request?: CopilotRequestSnapshot;
}

export interface CopilotSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: CopilotTurn[];
}

export interface CopilotAuditEntry {
  requestId: string;
  action: string;
  outcome: string | null;
  confidence: number;
  requiresHumanApproval: boolean;
  toolCalls: CopilotToolCallDto[];
  decision: string | null;
  proposalId: string | null;
  proposalHash: string | null;
  correlationId: string;
  idempotencyKey: string | null;
  promptKey: string;
  promptVersion: string;
  model: string | null;
  retrievedDocumentIds: string[];
}

export type CopilotErrorKind =
  | "budget"
  | "rate_limit"
  | "timeout"
  | "network"
  | "session"
  | "tool"
  | "unknown";

export interface CopilotErrorInfo {
  kind: CopilotErrorKind;
  message: string;
  retryable: boolean;
  remainingTokens?: number | undefined;
  retryAfterSeconds?: number | undefined;
}

export interface ApprovalProposal {
  proposalId: string;
  proposalHash: string;
  workflowInstanceId: string | null;
  proposedAction: string;
  expiresAt?: number | undefined;
}

let fallbackIdCounter = 0;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `copilot-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  // Non-browser test fallback only. A monotonic counter avoids insecure randomness in identifiers.
  fallbackIdCounter += 1;
  return `copilot-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

export function validateMessage(text: string): { ok: boolean; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a request before sending it to the Copilot." };
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `The request is ${text.length.toLocaleString()} characters; the limit is ${MAX_MESSAGE_LENGTH.toLocaleString()}.`,
    };
  }
  return { ok: true };
}

export function sessionTitleFromMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 60 ? `${normalized.slice(0, 57)}…` : normalized || "New conversation";
}

export function createSession(now = Date.now(), id = randomId()): CopilotSession {
  return {
    id,
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

export function appendTurn(session: CopilotSession, turn: CopilotTurn): CopilotSession {
  const title =
    session.turns.length === 0 && turn.role === "user"
      ? sessionTitleFromMessage(turn.text)
      : session.title;
  return {
    ...session,
    title,
    updatedAt: turn.createdAt,
    turns: [...session.turns, turn],
  };
}

export function replaceTurn(
  session: CopilotSession,
  turnId: string,
  update: Partial<CopilotTurn>,
): CopilotSession {
  return {
    ...session,
    updatedAt: Date.now(),
    turns: session.turns.map((turn) => (turn.id === turnId ? { ...turn, ...update } : turn)),
  };
}

export function createTurn(
  role: CopilotTurn["role"],
  text: string,
  requestId: string,
  status: TurnStatus = "complete",
  now = Date.now(),
  id = randomId(),
): CopilotTurn {
  return { id, role, text, requestId, status, createdAt: now };
}

export function storageKey(tenantId: string | null, userId: string | null): string {
  return `${SESSIONS_STORAGE_PREFIX}:${tenantId ?? "anonymous"}:${userId ?? "user"}`;
}

/** Reads sessions defensively; malformed storage must never break the Copilot screen. */
export function readSessions(storage: Pick<Storage, "getItem">, key: string): CopilotSession[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSession).sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

export function writeSessions(
  storage: Pick<Storage, "setItem">,
  key: string,
  sessions: CopilotSession[],
): void {
  try {
    storage.setItem(key, JSON.stringify(sessions));
  } catch {
    // Quota or privacy mode: history is best effort and never blocks a request.
  }
}

function isSession(value: unknown): value is CopilotSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.updatedAt === "number" &&
    Array.isArray(record.turns)
  );
}

/** Redacts sensitive argument keys and PII values before the UI renders tool arguments. */
export function redactArguments(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redactArguments(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
    return Object.fromEntries(
      entries.map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : redactArguments(entry, depth + 1),
      ]),
    );
  }
  return value;
}

function redactString(value: string): string {
  return value
    .replace(EMAIL, PII_REDACTED)
    .replace(IBAN, PII_REDACTED)
    .replace(CARD, PII_REDACTED)
    .replace(PHONE, PII_REDACTED);
}

export function toolCallStatus(call: CopilotToolCallDto): "ok" | "failed" {
  return call.ok ? "ok" : "failed";
}

export function citationsOf(response: CopilotResponseDto): CopilotCitationDto[] {
  return response.citations ?? [];
}

export function warningsOf(response: CopilotResponseDto): CopilotWarningDto[] {
  return response.warnings ?? [];
}

export function isNoAnswer(response: CopilotResponseDto): boolean {
  return response.outcome === "NO_ANSWER" || /^i don'?t know\./i.test(response.answer.trim());
}

export function isLowConfidence(response: CopilotResponseDto): boolean {
  return (
    response.outcome === "LOW_CONFIDENCE" ||
    (response.requires_human_approval && response.confidence > 0 && response.confidence < 0.7)
  );
}

/**
 * An answer that makes a factual claim needs a source. The backend marks knowledge answers with
 * structured citations; this flags the absence so the UI never silently presents an unsourced answer.
 */
export function lacksCitations(response: CopilotResponseDto): boolean {
  if (response.action !== "knowledge_search") {
    return false;
  }
  if (isNoAnswer(response)) {
    return false;
  }
  return citationsOf(response).length === 0;
}

export function budgetLabel(budget: CopilotBudgetDto | null | undefined): string {
  if (!budget || budget.remaining_tokens === null || budget.remaining_tokens === undefined) {
    return "Remaining AI budget: not reported by this deployment.";
  }
  const remaining = budget.remaining_tokens.toLocaleString();
  if (
    budget.monthly_budget_tokens === null ||
    budget.monthly_budget_tokens === undefined
  ) {
    return `Remaining AI budget: ${remaining} tokens.`;
  }
  const used = (budget.used_tokens ?? 0).toLocaleString();
  const monthly = budget.monthly_budget_tokens.toLocaleString();
  return `Remaining AI budget: ${remaining} tokens (used ${used} of ${monthly}).`;
}

export function approvalProposalOf(response: CopilotResponseDto): ApprovalProposal | null {
  if (!response.data || typeof response.data !== "object") {
    return null;
  }
  const data = response.data as Record<string, unknown>;
  const proposalId = data.proposalId;
  const proposalHash = data.proposalHash;
  if (typeof proposalId !== "string" || typeof proposalHash !== "string") {
    return null;
  }
  return {
    proposalId,
    proposalHash,
    workflowInstanceId:
      typeof data.workflowInstanceId === "string" ? data.workflowInstanceId : null,
    proposedAction: typeof data.proposedAction === "string" ? data.proposedAction : "create_approval",
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : undefined,
  };
}

/** Builds one deduplicated audit entry per logical request. */
export function auditEntriesFromTurns(turns: CopilotTurn[]): CopilotAuditEntry[] {
  const entries = new Map<string, CopilotAuditEntry>();
  for (const turn of turns) {
    if (turn.role !== "assistant" || !turn.response) {
      continue;
    }
    const response = turn.response;
    const audit = response.audit;
    const requestId =
      audit?.request_id ||
      response.idempotency_key ||
      response.correlation_id ||
      turn.requestId;
    if (entries.has(requestId)) {
      continue;
    }
    entries.set(requestId, {
      requestId,
      action: audit?.action ?? response.action,
      outcome: audit?.outcome ?? response.outcome ?? null,
      confidence: audit?.confidence ?? response.confidence,
      requiresHumanApproval: audit?.requires_human_approval ?? response.requires_human_approval,
      toolCalls: audit?.tool_calls ?? response.tool_calls,
      decision: audit?.decision ?? null,
      proposalId: audit?.proposal_id ?? null,
      proposalHash: audit?.proposal_hash ?? null,
      correlationId: audit?.correlation_id ?? response.correlation_id,
      idempotencyKey: audit?.idempotency_key ?? response.idempotency_key,
      promptKey: audit?.prompt_key ?? "",
      promptVersion: audit?.prompt_version ?? response.prompt_version,
      model: audit?.model ?? response.model,
      retrievedDocumentIds: audit?.retrieved_document_ids ?? [],
    });
  }
  return [...entries.values()];
}

export function mergeAuditEntries(
  existing: CopilotAuditEntry[],
  next: CopilotAuditEntry,
): CopilotAuditEntry[] {
  if (existing.some((entry) => entry.requestId === next.requestId)) {
    return existing;
  }
  return [...existing, next];
}

function remainingTokensFrom(message: string): number | undefined {
  const match = message.match(/Remaining tokens:\s*([\d,]+)/i);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

/** Converts transport/API failures into user-facing, retry-aware copy. */
export function classifyCopilotError(error: unknown): CopilotErrorInfo {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      kind: "unknown",
      message: "The Copilot response was cancelled.",
      retryable: true,
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "network",
      message:
        "The connection dropped before the Copilot answered. Reconnect and retry; the same request key is kept so no action can run twice.",
      retryable: true,
    };
  }
  const status = error instanceof ApiError ? error.status : errorStatus(error);
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (status === 401) {
    return {
      kind: "session",
      message: "Your session expired. Sign in again to continue; the request was not sent twice.",
      retryable: false,
    };
  }
  if (status === 408 || status === 504) {
    return {
      kind: "timeout",
      message:
        "The Copilot timed out. A retry is safe because it keeps the same idempotency key.",
      retryable: true,
    };
  }
  if (status === 429) {
    const remainingTokens = remainingTokensFrom(message);
    const budget = /budget|token/i.test(message);
    return {
      kind: budget ? "budget" : "rate_limit",
      message: budget
        ? `The tenant AI budget is exhausted.${
            remainingTokens === undefined
              ? ""
              : ` Remaining tokens: ${remainingTokens.toLocaleString()}.`
          } Ask a tenant administrator to raise the budget or try next month.`
        : "The Copilot is receiving too many requests. Wait a moment and retry.",
      retryable: !budget,
      ...(remainingTokens === undefined ? {} : { remainingTokens }),
      retryAfterSeconds:
        error instanceof ApiError ? error.retryAfterSeconds : undefined,
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      kind: "tool",
      message:
        "A backing service failed. Tool cards show which call failed; retrying with the same request key is safe.",
      retryable: true,
    };
  }
  return {
    kind: "unknown",
    message: message || "The Copilot request failed.",
    retryable: true,
  };
}

/**
 * Splits an answer into progressive reveal chunks. The first chunk is emitted immediately so the
 * measured first-token time is the transport response time, not a fixed animation delay.
 */
export function streamChunks(text: string, size = MAX_REVEAL_CHUNK): string[] {
  if (!text) {
    return [];
  }
  const chunks: string[] = [];
  let current = "";
  for (const token of text.split(/(\s+)/)) {
    if (current.length > 0 && current.length + token.length > size) {
      chunks.push(current);
      current = token;
    } else {
      current += token;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  copilotApprovalAssistance,
  copilotChat,
  copilotKnowledgeSearch,
  copilotTaskDecision,
  type CopilotApprovalPayload,
  type CopilotBudgetDto,
  type CopilotChatPayload,
  type CopilotResponseDto,
} from "../api";
import {
  appendTurn,
  approvalProposalOf,
  classifyCopilotError,
  createSession,
  createTurn,
  readSessions,
  replaceTurn,
  storageKey,
  streamChunks,
  validateMessage,
  writeSessions,
  type ApprovalProposal,
  type CopilotErrorInfo,
  type CopilotRequestSnapshot,
  type CopilotSession,
} from "../copilot";
import { newIdempotencyKey } from "../copilotIdempotency";
import { queryKeys } from "../queryKeys";
import { useActiveTenant } from "./useActiveTenant";

/** Sends one copilot turn. Mutations are never retried (an action must not run twice). */
export function useCopilotChat() {
  return useMutation<CopilotResponseDto, Error, CopilotChatPayload>({
    mutationKey: queryKeys.copilot.chat(),
    mutationFn: (payload) => copilotChat(payload),
  });
}

export function useCopilotTaskDecision() {
  return useMutation<
    CopilotResponseDto,
    Error,
    { taskId: string; decision: "approve" | "reject" | "complete"; comment?: string }
  >({
    mutationKey: queryKeys.copilot.decision(),
    mutationFn: ({ taskId, decision, comment }) =>
      copilotTaskDecision(taskId, decision, comment, true),
  });
}

/** Two-step approval: call once to propose, then again with the proposal id/hash and confirm. */
export function useCopilotApproval() {
  return useMutation<CopilotResponseDto, Error, CopilotApprovalPayload>({
    mutationKey: queryKeys.copilot.approval(),
    mutationFn: (payload) => copilotApprovalAssistance(payload),
  });
}

export function useCopilotKnowledgeSearch() {
  return useMutation<CopilotResponseDto, Error, string>({
    mutationKey: queryKeys.copilot.knowledge(),
    mutationFn: copilotKnowledgeSearch,
  });
}

export interface ApprovalDraft {
  workflowInstanceId: string;
  title: string;
  description?: string;
  assigneeId?: string;
}

export interface PendingHitl {
  kind: "approval" | "chat";
  summary: string;
  idempotencyKey: string;
  proposal?: ApprovalProposal;
  payloadHash?: string;
  approvalRequest?: CopilotApprovalPayload;
  chatRequest?: CopilotChatPayload;
}

export interface UseCopilotConversationOptions {
  tenantId?: string | null;
  userId?: string | null;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  revealIntervalMs?: number;
  revealChunkSize?: number;
}

export interface UseCopilotConversationResult {
  sessions: CopilotSession[];
  activeSession: CopilotSession | null;
  turns: CopilotSession["turns"];
  status: "idle" | "sending" | "streaming";
  firstTokenMs: number | null;
  error: CopilotErrorInfo | null;
  budget: CopilotBudgetDto | null;
  pendingHitl: PendingHitl | null;
  send: (message: string) => Promise<void>;
  cancel: () => void;
  retry: () => Promise<void>;
  newSession: () => void;
  selectSession: (id: string) => void;
  proposeApproval: (draft: ApprovalDraft) => Promise<void>;
  approvePending: () => Promise<void>;
  rejectPending: () => void;
  clearError: () => void;
}

const HIGH_RISK_ACTIONS = new Set([
  "start_workflow",
  "complete_task",
  "assign_task",
  "send_notification",
]);

function loadSessions(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  key: string,
): CopilotSession[] {
  if (!storage) {
    return [createSession()];
  }
  const loaded = readSessions(storage, key);
  return loaded.length > 0 ? loaded : [createSession()];
}

function hitlFor(response: CopilotResponseDto, request: CopilotChatPayload): PendingHitl | null {
  if (!response.requires_human_approval) {
    return null;
  }
  if (!HIGH_RISK_ACTIONS.has(response.action)) {
    // No-answer and low-confidence responses use the explicit human-review path, not a resend.
    return null;
  }
  return {
    kind: "chat",
    summary: response.answer,
    idempotencyKey: request.idempotency_key ?? newIdempotencyKey(),
    chatRequest: request,
  };
}

export function useCopilotConversation(
  options: UseCopilotConversationOptions = {},
): UseCopilotConversationResult {
  const activeTenant = useActiveTenant();
  const tenantId = options.tenantId !== undefined ? options.tenantId : activeTenant;
  const userId = options.userId ?? null;
  const revealIntervalMs = options.revealIntervalMs ?? 18;
  const revealChunkSize = options.revealChunkSize ?? 48;
  const storage = useMemo(() => {
    if (options.storage !== undefined) {
      return options.storage;
    }
    return typeof window === "undefined" ? null : window.localStorage;
  }, [options.storage]);
  const key = useMemo(() => storageKey(tenantId, userId), [tenantId, userId]);
  const initialSessions = useMemo(() => loadSessions(storage, key), [key, storage]);

  const [sessions, setSessions] = useState<CopilotSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessions[0]?.id ?? null,
  );
  // A synchronous mirror of the active id: a caller that immediately proposes after clicking
  // "New chat" must append to the new session, not to the previous render's session.
  const activeSessionIdRef = useRef<string | null>(initialSessions[0]?.id ?? null);
  const [status, setStatus] = useState<"idle" | "sending" | "streaming">("idle");
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [error, setError] = useState<CopilotErrorInfo | null>(null);
  const [budget, setBudget] = useState<CopilotBudgetDto | null>(null);
  const [pendingHitl, setPendingHitl] = useState<PendingHitl | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const lastRequestRef = useRef<{
    request: CopilotChatPayload;
    sessionId: string;
    turnId: string;
  } | null>(null);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;

  useEffect(() => {
    if (!storage) {
      return;
    }
    writeSessions(storage, key, sessions);
  }, [key, sessions, storage]);

  useEffect(() => {
    // Copy the ref value for the cleanup; the map identity is stable for the hook lifetime.
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearInterval(timer);
      }
      timers.clear();
      abortRef.current?.abort();
    };
  }, []);

  const updateSession = useCallback((sessionId: string, update: (session: CopilotSession) => CopilotSession) => {
    setSessions((previous) =>
      previous.map((session) => (session.id === sessionId ? update(session) : session)),
    );
  }, []);

  const updateTurn = useCallback(
    (sessionId: string, turnId: string, update: Parameters<typeof replaceTurn>[2]) => {
      updateSession(sessionId, (session) => replaceTurn(session, turnId, update));
    },
    [updateSession],
  );

  const stopReveal = useCallback((turnId: string) => {
    const timer = timersRef.current.get(turnId);
    if (timer !== undefined) {
      clearInterval(timer);
      timersRef.current.delete(turnId);
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    for (const turnId of [...timersRef.current.keys()]) {
      stopReveal(turnId);
    }
    setSessions((previous) =>
      previous.map((session) => ({
        ...session,
        turns: session.turns.map((turn) =>
          turn.status === "streaming" ? { ...turn, status: "cancelled" } : turn,
        ),
      })),
    );
    setStatus("idle");
  }, [stopReveal]);

  const reveal = useCallback(
    (sessionId: string, turnId: string, text: string) => {
      const chunks = streamChunks(text, revealChunkSize);
      if (chunks.length === 0) {
        updateTurn(sessionId, turnId, { text: "", status: "complete" });
        setStatus("idle");
        return;
      }
      updateTurn(sessionId, turnId, { text: "", status: "streaming" });
      setStatus("streaming");
      let index = 0;
      const tick = () => {
        if (index >= chunks.length) {
          stopReveal(turnId);
          updateTurn(sessionId, turnId, {
            text: chunks.join(""),
            status: "complete",
          });
          setStatus("idle");
          return;
        }
        index += 1;
        updateTurn(sessionId, turnId, { text: chunks.slice(0, index).join("") });
      };
      if (revealIntervalMs <= 0) {
        index = chunks.length;
        tick();
        return;
      }
      const timer = setInterval(tick, revealIntervalMs);
      timersRef.current.set(turnId, timer);
      // Emit the first chunk immediately: the first-token measurement is about transport time, not
      // a fixed animation delay.
      tick();
    },
    [revealChunkSize, revealIntervalMs, stopReveal, updateTurn],
  );

  const finishResponse = useCallback(
    (
      sessionId: string,
      turnId: string,
      response: CopilotResponseDto,
      pending: PendingHitl | null,
      requestId: string,
    ) => {
      setBudget(response.budget ?? null);
      updateTurn(sessionId, turnId, { response, requestId });
      setPendingHitl(pending);
      reveal(sessionId, turnId, response.answer);
    },
    [reveal, updateTurn],
  );

  const execute = useCallback(
    async (
      request: CopilotChatPayload,
      sessionId: string,
      turnId: string,
      requestId: string,
    ): Promise<void> => {
      setStatus("sending");
      setError(null);
      setFirstTokenMs(null);
      lastRequestRef.current = { request, sessionId, turnId };
      // One automatic retry for a timeout. The request key is unchanged, so a replay cannot run the
      // action twice even when the first attempt reached the backend before the timeout.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const started = performance.now();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const response = await copilotChat(request, controller.signal);
          if (controller.signal.aborted) {
            return;
          }
          setFirstTokenMs(Math.max(0, Math.round(performance.now() - started)));
          finishResponse(sessionId, turnId, response, hitlFor(response, request), requestId);
          return;
        } catch (failure) {
          if (controller.signal.aborted) {
            updateTurn(sessionId, turnId, { status: "cancelled" });
            setStatus("idle");
            return;
          }
          const info = classifyCopilotError(failure);
          if (info.kind === "timeout" && attempt === 0) {
            updateTurn(sessionId, turnId, {
              text: "The Copilot timed out; retrying with the same request key…",
              status: "streaming",
            });
            continue;
          }
          setError(info);
          updateTurn(sessionId, turnId, {
            text: info.message,
            status: "error",
            error: info.message,
            requestId,
          });
          setStatus("idle");
          if (info.kind === "budget" && info.remainingTokens !== undefined) {
            setBudget((previous) => ({
              remaining_tokens: info.remainingTokens ?? 0,
              monthly_budget_tokens: previous?.monthly_budget_tokens ?? null,
              used_tokens: previous?.used_tokens ?? null,
              estimated_cost_micros: previous?.estimated_cost_micros ?? null,
            }));
          }
          return;
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        }
      }
    },
    [finishResponse, updateTurn],
  );

  const ensureSession = useCallback((): string => {
    if (activeSessionIdRef.current) {
      return activeSessionIdRef.current;
    }
    const session = createSession();
    activeSessionIdRef.current = session.id;
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(session.id);
    return session.id;
  }, []);

  const send = useCallback(
    async (message: string) => {
      const validation = validateMessage(message);
      if (!validation.ok) {
        setError({
          kind: "unknown",
          message: validation.error ?? "The request is invalid.",
          retryable: false,
        });
        return;
      }
      const sessionId = ensureSession();
      const requestId = newIdempotencyKey();
      const now = Date.now();
      const userTurn = createTurn("user", message.trim(), requestId, "complete", now);
      const assistantTurn = createTurn("assistant", "", requestId, "streaming", now + 1);
      updateSession(sessionId, (session) => {
        const withUser = appendTurn(session, userTurn);
        return appendTurn(withUser, assistantTurn);
      });
      const request: CopilotChatPayload = {
        message: message.trim(),
        idempotency_key: requestId,
        confirm_high_risk: false,
      };
      await execute(request, sessionId, assistantTurn.id, requestId);
    },
    [ensureSession, execute, updateSession],
  );

  const retry = useCallback(async () => {
    const last = lastRequestRef.current;
    if (!last) {
      return;
    }
    const assistantTurn = createTurn(
      "assistant",
      "",
      last.request.idempotency_key ?? newIdempotencyKey(),
      "streaming",
    );
    updateSession(last.sessionId, (session) => appendTurn(session, assistantTurn));
    await execute(
      last.request,
      last.sessionId,
      assistantTurn.id,
      assistantTurn.requestId,
    );
  }, [execute, updateSession]);

  const newSession = useCallback(() => {
    const session = createSession();
    activeSessionIdRef.current = session.id;
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(session.id);
    setPendingHitl(null);
    setError(null);
    setBudget(null);
    setFirstTokenMs(null);
  }, []);

  const selectSession = useCallback((id: string) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
    setPendingHitl(null);
    setError(null);
  }, []);

  const proposeApproval = useCallback(
    async (draft: ApprovalDraft) => {
      const trimmedTitle = draft.title.trim();
      if (!draft.workflowInstanceId.trim() || !trimmedTitle) {
        setError({
          kind: "unknown",
          message: "A workflow instance id and title are required to prepare an approval.",
          retryable: false,
        });
        return;
      }
      const sessionId = ensureSession();
      const requestId = newIdempotencyKey();
      const now = Date.now();
      const userTurn = createTurn(
        "user",
        `Prepare approval: ${trimmedTitle}`,
        requestId,
        "complete",
        now,
      );
      const assistantTurn = createTurn("assistant", "", requestId, "streaming", now + 1);
      updateSession(sessionId, (session) => {
        const withUser = appendTurn(session, userTurn);
        return appendTurn(withUser, assistantTurn);
      });
      const description = draft.description?.trim();
      const assigneeId = draft.assigneeId?.trim();
      const request: CopilotApprovalPayload = {
        workflow_instance_id: draft.workflowInstanceId.trim(),
        title: trimmedTitle,
        confirm: false,
        idempotency_key: requestId,
        ...(description ? { description } : {}),
        ...(assigneeId ? { assignee_id: assigneeId } : {}),
      };
      setStatus("sending");
      setError(null);
      const started = performance.now();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await copilotApprovalAssistance(request, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setFirstTokenMs(Math.max(0, Math.round(performance.now() - started)));
        const proposal = approvalProposalOf(response);
        const pending: PendingHitl | null = proposal
          ? {
              kind: "approval",
              summary: response.answer,
              idempotencyKey: requestId,
              proposal,
              payloadHash: proposal.proposalHash,
              approvalRequest: request,
            }
          : null;
        finishResponse(sessionId, assistantTurn.id, response, pending, requestId);
      } catch (failure) {
        if (controller.signal.aborted) {
          updateTurn(sessionId, assistantTurn.id, { status: "cancelled" });
          setStatus("idle");
          return;
        }
        const info = classifyCopilotError(failure);
        setError(info);
        updateTurn(sessionId, assistantTurn.id, {
          text: info.message,
          status: "error",
          error: info.message,
          requestId,
        });
        setStatus("idle");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [ensureSession, finishResponse, updateTurn, updateSession],
  );

  const approvePending = useCallback(async () => {
    const pending = pendingHitl;
    if (!pending) {
      return;
    }
    const sessionId = ensureSession();
    const now = Date.now();
    const requestId = pending.idempotencyKey;
    const assistantTurn = createTurn("assistant", "", requestId, "streaming", now);
    updateSession(sessionId, (session) => appendTurn(session, assistantTurn));
    setStatus("sending");
    setError(null);
    setFirstTokenMs(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = performance.now();
    try {
      let response: CopilotResponseDto;
      if (pending.kind === "approval" && pending.approvalRequest && pending.proposal) {
        response = await copilotApprovalAssistance(
          {
            ...pending.approvalRequest,
            confirm: true,
            proposal_id: pending.proposal.proposalId,
            proposal_hash: pending.proposal.proposalHash,
            idempotency_key: pending.idempotencyKey,
          },
          controller.signal,
        );
      } else if (pending.chatRequest) {
        response = await copilotChat(
          {
            ...pending.chatRequest,
            confirm_high_risk: true,
            idempotency_key: pending.idempotencyKey,
          },
          controller.signal,
        );
      } else {
        return;
      }
      if (controller.signal.aborted) {
        return;
      }
      setFirstTokenMs(Math.max(0, Math.round(performance.now() - started)));
      setPendingHitl(null);
      finishResponse(sessionId, assistantTurn.id, response, null, requestId);
    } catch (failure) {
      if (controller.signal.aborted) {
        updateTurn(sessionId, assistantTurn.id, { status: "cancelled" });
        setStatus("idle");
        return;
      }
      const info = classifyCopilotError(failure);
      setError(info);
      updateTurn(sessionId, assistantTurn.id, {
        text: info.message,
        status: "error",
        error: info.message,
        requestId,
      });
      setStatus("idle");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [ensureSession, finishResponse, pendingHitl, updateTurn, updateSession]);

  const rejectPending = useCallback(() => {
    const sessionId = ensureSession();
    const turn = createTurn(
      "assistant",
      "Rejected. No approval request was sent and no action was taken.",
      newIdempotencyKey(),
      "complete",
    );
    updateSession(sessionId, (session) => appendTurn(session, turn));
    setPendingHitl(null);
    setStatus("idle");
    setError(null);
  }, [ensureSession, updateSession]);

  const clearError = useCallback(() => setError(null), []);

  return {
    sessions,
    activeSession,
    turns: activeSession?.turns ?? [],
    status,
    firstTokenMs,
    error,
    budget,
    pendingHitl,
    send,
    cancel,
    retry,
    newSession,
    selectSession,
    proposeApproval,
    approvePending,
    rejectPending,
    clearError,
  };
}

export type { CopilotRequestSnapshot };

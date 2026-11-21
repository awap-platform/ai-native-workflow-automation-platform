import { act, renderHook, waitFor } from "@testing-library/react";

import * as api from "../../api";
import type { CopilotResponseDto } from "../../api";
import { useCopilotConversation } from "../useCopilot";

jest.mock("../../api", () => {
  class ApiError extends Error {
    readonly status: number;
    readonly correlationId: string | undefined;
    readonly retryAfterSeconds: number | undefined;

    constructor(
      status: number,
      message: string,
      correlationId?: string,
      retryAfterSeconds?: number,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.correlationId = correlationId;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
  return {
    ApiError,
    errorStatus: (error: unknown) => (error instanceof ApiError ? error.status : undefined),
    copilotChat: jest.fn(),
    copilotApprovalAssistance: jest.fn(),
    copilotKnowledgeSearch: jest.fn(),
    copilotTaskDecision: jest.fn(),
  };
});

jest.mock("../useActiveTenant", () => ({
  useActiveTenant: () => "tenant-a",
}));

const chat = api.copilotChat as jest.MockedFunction<typeof api.copilotChat>;
const approval = api.copilotApprovalAssistance as jest.MockedFunction<
  typeof api.copilotApprovalAssistance
>;

function response(overrides: Partial<CopilotResponseDto> = {}): CopilotResponseDto {
  return {
    answer: "The leave policy allows 20 days of annual leave.",
    action: "knowledge_search",
    confidence: 0.9,
    requires_human_approval: false,
    tool_calls: [
      { name: "search_documents", arguments: { query: "leave" }, result: [], ok: true, error: null },
    ],
    data: [],
    model: "gpt-4o-mini",
    model_tier: "standard",
    prompt_version: "v1",
    correlation_id: "corr-1",
    idempotency_key: "idem-1",
    outcome: "SUCCESS",
    citations: [
      { index: 1, title: "Leave policy.pdf", document_id: "file-1", chunk_index: 0, score: 0.9 },
    ],
    budget: {
      remaining_tokens: 900,
      monthly_budget_tokens: 1000,
      used_tokens: 100,
      estimated_cost_micros: 20,
    },
    warnings: [],
    guardrail: {
      policy: null,
      decision: "allow",
      score: 0,
      version: "v1",
      unavailable: false,
    },
    audit: {
      request_id: "idem-1",
      action: "knowledge_search",
      outcome: "SUCCESS",
      confidence: 0.9,
      requires_human_approval: false,
      tool_calls: [],
      idempotency_key: "idem-1",
      correlation_id: "corr-1",
      prompt_key: "knowledge_search",
      prompt_version: "v1",
      prompt_hash: "a".repeat(64),
      model: "gpt-4o-mini",
      model_tier: "standard",
      routing_reason: "moderate complexity",
      proposal_id: null,
      proposal_hash: null,
      decision: null,
      retrieved_document_ids: ["file-1"],
    },
    ...overrides,
  };
}

function proposalResponse(): CopilotResponseDto {
  return response({
    answer: "Review the approval payload before confirming.",
    action: "approval_assistance",
    requires_human_approval: true,
    data: {
      workflowInstanceId: "inst-1",
      proposalId: "proposal-1",
      proposalHash: "b".repeat(64),
      proposedAction: "create_approval",
      expiresAt: 123,
    },
    audit: {
      ...response().audit!,
      request_id: "approval-key",
      action: "approval_assistance",
      requires_human_approval: true,
      decision: "PROPOSED",
      proposal_id: "proposal-1",
      proposal_hash: "b".repeat(64),
    },
  });
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function options(tenantId = "tenant-a", storage = memoryStorage()) {
  return { tenantId, storage, revealIntervalMs: 0, revealChunkSize: 1_000 };
}

describe("useCopilotConversation", () => {
  beforeEach(() => {
    chat.mockReset();
    approval.mockReset();
  });

  it("sends a chat turn, exposes metadata and measures the first token under two seconds", async () => {
    chat.mockResolvedValue(response());
    const { result } = renderHook(() => useCopilotConversation(options()));

    await act(async () => {
      await result.current.send("find the leave policy");
    });

    expect(chat).toHaveBeenCalledTimes(1);
    const payload = chat.mock.calls[0]![0];
    expect(payload.idempotency_key).toBeTruthy();
    expect(result.current.turns).toHaveLength(2);
    const assistant = result.current.turns[1]!;
    expect(assistant.response?.citations).toHaveLength(1);
    expect(assistant.status).toBe("complete");
    expect(result.current.firstTokenMs).not.toBeNull();
    expect(result.current.firstTokenMs!).toBeLessThan(2_000);
  });

  it("retries a timeout once with the same idempotency key", async () => {
    chat
      .mockRejectedValueOnce(new api.ApiError(504, "gateway timeout"))
      .mockResolvedValueOnce(response());
    const { result } = renderHook(() => useCopilotConversation(options()));

    await act(async () => {
      await result.current.send("hello");
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0]![0].idempotency_key).toBe(chat.mock.calls[1]![0].idempotency_key);
    expect(result.current.turns.at(-1)?.status).toBe("complete");
  });

  it("shows budget remaining on a 429", async () => {
    chat.mockRejectedValue(new api.ApiError(429, "AI budget exhausted. Remaining tokens: 0."));
    const { result } = renderHook(() => useCopilotConversation(options()));

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.error?.kind).toBe("budget");
    expect(result.current.error?.remainingTokens).toBe(0);
    expect(result.current.budget?.remaining_tokens).toBe(0);
  });

  it("approves a proposal with the same idempotency key", async () => {
    approval.mockResolvedValueOnce(proposalResponse()).mockResolvedValueOnce(
      response({ answer: "The approval task was created.", action: "approval_assistance" }),
    );
    const { result } = renderHook(() => useCopilotConversation(options()));

    await act(async () => {
      await result.current.proposeApproval({
        workflowInstanceId: "inst-1",
        title: "Approve leave",
        description: "Ada requested three days.",
      });
    });

    expect(result.current.pendingHitl?.proposal?.proposalId).toBe("proposal-1");
    expect(result.current.pendingHitl?.payloadHash).toBe("b".repeat(64));
    const firstKey = approval.mock.calls[0]![0].idempotency_key;
    expect(firstKey).toBeTruthy();

    await act(async () => {
      await result.current.approvePending();
    });

    expect(approval).toHaveBeenCalledTimes(2);
    const confirmation = approval.mock.calls[1]![0];
    expect(confirmation.confirm).toBe(true);
    expect(confirmation.proposal_id).toBe("proposal-1");
    expect(confirmation.proposal_hash).toBe("b".repeat(64));
    expect(confirmation.idempotency_key).toBe(firstKey);
    expect(result.current.pendingHitl).toBeNull();
  });

  it("rejects without sending a second action", async () => {
    approval.mockResolvedValueOnce(proposalResponse());
    const { result } = renderHook(() => useCopilotConversation(options()));

    await act(async () => {
      await result.current.proposeApproval({ workflowInstanceId: "inst-1", title: "Approve leave" });
    });
    expect(result.current.pendingHitl).not.toBeNull();

    act(() => {
      result.current.rejectPending();
    });

    expect(approval).toHaveBeenCalledTimes(1);
    expect(result.current.pendingHitl).toBeNull();
    expect(result.current.turns.at(-1)?.text).toContain("No approval request was sent");
  });

  it("cancels a streaming response", async () => {
    chat.mockImplementation(
      (_payload, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const { result } = renderHook(() => useCopilotConversation(options()));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.send("hello");
    });
    await waitFor(() => expect(result.current.status).toBe("sending"));

    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      await pending;
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.turns.at(-1)?.status).toBe("cancelled");
  });

  it("keeps tenant A history out of tenant B", async () => {
    chat.mockResolvedValue(response());
    const storage = memoryStorage();
    const first = renderHook(() => useCopilotConversation(options("tenant-a", storage)));
    await act(async () => {
      await first.result.current.send("tenant A only");
    });
    expect(first.result.current.turns.length).toBeGreaterThan(0);
    first.unmount();

    const second = renderHook(() => useCopilotConversation(options("tenant-b", storage)));
    expect(second.result.current.turns).toHaveLength(0);
    expect(second.result.current.sessions).toHaveLength(1);
    expect(second.result.current.sessions[0]!.title).toBe("New conversation");
  });
});

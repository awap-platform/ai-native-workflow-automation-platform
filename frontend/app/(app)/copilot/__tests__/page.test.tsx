import { fireEvent, render, screen, within } from "@testing-library/react";

import type { CopilotResponseDto } from "../../../../lib/api";
import type { PendingHitl, UseCopilotConversationResult } from "../../../../lib/hooks/useCopilot";
import type { CopilotSession } from "../../../../lib/copilot";
import CopilotPage from "../page";

jest.mock("../../../../lib/hooks/useActiveTenant", () => ({
  useActiveTenant: () => "tenant-a",
}));

const send = jest.fn();
const cancel = jest.fn();
const retry = jest.fn();
const newSession = jest.fn();
const selectSession = jest.fn();
const proposeApproval = jest.fn();
const approvePending = jest.fn();
const rejectPending = jest.fn();
const clearError = jest.fn();

let hookState: UseCopilotConversationResult;

jest.mock("../../../../lib/hooks/useCopilot", () => ({
  useCopilotConversation: () => hookState,
}));

function response(overrides: Partial<CopilotResponseDto> = {}): CopilotResponseDto {
  return {
    answer: "The leave policy allows 20 days of annual leave.",
    action: "knowledge_search",
    confidence: 0.9,
    requires_human_approval: false,
    tool_calls: [
      {
        name: "search_documents",
        arguments: { query: "leave", note: "ada@acme.com", token: "secret" },
        result: [],
        ok: true,
        error: null,
      },
    ],
    data: [],
    model: "gpt-4o-mini",
    model_tier: "standard",
    prompt_version: "v1",
    correlation_id: "corr-1",
    idempotency_key: "idem-1",
    outcome: "SUCCESS",
    citations: [
      { index: 1, title: "Leave policy.pdf", document_id: "file-1", chunk_index: 2, score: 0.9 },
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

function sessionWith(
  turnResponse?: CopilotResponseDto,
  status: "complete" | "streaming" = "complete",
): CopilotSession {
  const turns = turnResponse
    ? [
        {
          id: "u1",
          role: "user" as const,
          text: "find the leave policy",
          createdAt: 1,
          requestId: "idem-1",
          status: "complete" as const,
        },
        {
          id: "a1",
          role: "assistant" as const,
          text: turnResponse.answer,
          createdAt: 2,
          requestId: "idem-1",
          status,
          response: turnResponse,
        },
      ]
    : [];
  return { id: "s1", title: "Leave policy", createdAt: 1, updatedAt: 2, turns };
}

function state(
  overrides: Partial<UseCopilotConversationResult> = {},
): UseCopilotConversationResult {
  const session = sessionWith(response());
  return {
    sessions: [session],
    activeSession: session,
    turns: session.turns,
    status: "idle",
    firstTokenMs: 420,
    error: null,
    budget: response().budget ?? null,
    pendingHitl: null,
    sync: "synced",
    send,
    cancel,
    retry,
    newSession,
    selectSession,
    proposeApproval,
    approvePending,
    rejectPending,
    clearError,
    ...overrides,
  };
}

function pendingApproval(): PendingHitl {
  return {
    kind: "approval",
    summary: "Review the approval payload before confirming.",
    idempotencyKey: "approval-key",
    payloadHash: "b".repeat(64),
    proposal: {
      proposalId: "proposal-1",
      proposalHash: "b".repeat(64),
      workflowInstanceId: "inst-1",
      proposedAction: "create_approval",
      expiresAt: 123,
    },
    approvalRequest: {
      workflow_instance_id: "inst-1",
      title: "Approve leave",
      description: "Ada requested three days.",
      confirm: false,
      idempotency_key: "approval-key",
    },
  };
}

describe("CopilotPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hookState = state();
  });

  it("renders the heading, suggestion cards and budget", () => {
    render(<CopilotPage />);

    expect(screen.getByRole("heading", { name: "AI Copilot" })).toBeInTheDocument();
    expect(screen.getByTestId("copilot-suggestions")).toBeInTheDocument();
    expect(screen.getByTestId("copilot-budget")).toHaveTextContent("Remaining AI budget: 900");
    expect(screen.getByTestId("copilot-first-token")).toHaveTextContent("420");
  });

  it("sends a suggestion prompt through the conversation hook", () => {
    render(<CopilotPage />);

    fireEvent.click(screen.getByTestId("copilot-suggestion-knowledge"));

    expect(send).toHaveBeenCalledWith("Find the leave policy in our tenant documents");
  });

  it("renders citations, tool-call status and redacted arguments", () => {
    render(<CopilotPage />);

    expect(screen.getByText("Leave policy.pdf")).toBeInTheDocument();
    expect(screen.getByTestId("copilot-citations")).toBeInTheDocument();

    const toolCall = screen.getByTestId("copilot-tool-call");
    expect(within(toolCall).getByText("search_documents")).toBeInTheDocument();
    expect(within(toolCall).getByText("ok")).toBeInTheDocument();
    const argumentsBlock = screen.getByLabelText("search_documents arguments");
    expect(argumentsBlock).toHaveTextContent("[REDACTED]");
    expect(argumentsBlock).toHaveTextContent("[PII_REDACTED]");
    expect(argumentsBlock).not.toHaveTextContent("ada@acme.com");
  });

  it("renders the audit view with one deduplicated request", () => {
    render(<CopilotPage />);

    const audit = screen.getByTestId("copilot-audit");
    expect(within(audit).getByText(/Audit trail \(1 request\)/)).toBeInTheDocument();
    expect(within(audit).getAllByTestId("copilot-audit-entry")).toHaveLength(1);
  });

  it("shows the no-answer state with an explicit human-review path", () => {
    hookState = state({
      turns: sessionWith(
        response({
          answer: "I don't know. I could not find a tenant document.",
          outcome: "NO_ANSWER",
          requires_human_approval: true,
          citations: [],
        }),
      ).turns,
    });
    render(<CopilotPage />);

    expect(screen.getByTestId("copilot-no-answer")).toHaveTextContent("does not know the answer");
    expect(screen.getByRole("link", { name: /Open the task inbox/i })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  it("flags a successful knowledge answer that has no citation", () => {
    hookState = state({
      turns: sessionWith(
        response({
          answer: "The policy allows 20 days.",
          citations: [],
          outcome: "SUCCESS",
        }),
      ).turns,
    });
    render(<CopilotPage />);

    expect(screen.getByTestId("copilot-missing-citations")).toHaveTextContent("no source citation");
  });

  it("shows low-confidence and guardrail warnings", () => {
    hookState = state({
      turns: sessionWith(
        response({
          outcome: "LOW_CONFIDENCE",
          confidence: 0.2,
          requires_human_approval: true,
          warnings: [
            {
              code: "PII_REDACTED",
              message: "Personal data in the request was redacted.",
              severity: "warning",
            },
            {
              code: "GUARDRAIL_PROMPT_INJECTION_BLOCKED",
              message: "The request was blocked by the safety policy.",
              severity: "error",
            },
          ],
        }),
      ).turns,
    });
    render(<CopilotPage />);

    expect(screen.getByTestId("copilot-low-confidence")).toBeInTheDocument();
    expect(screen.getByTestId("copilot-warnings")).toHaveTextContent("PII_REDACTED");
    expect(screen.getByTestId("copilot-warnings")).toHaveTextContent("GUARDRAIL_PROMPT_INJECTION");
  });

  it("renders the HITL panel with summary and payload hash and calls approve or reject", () => {
    hookState = state({ pendingHitl: pendingApproval() });
    render(<CopilotPage />);

    expect(screen.getByTestId("copilot-hitl-panel")).toHaveTextContent("Human confirmation");
    expect(screen.getByTestId("copilot-hitl-hash")).toHaveTextContent("b".repeat(64));
    expect(screen.getByTestId("copilot-hitl-action")).toHaveTextContent("create_approval");

    fireEvent.click(screen.getByTestId("copilot-hitl-approve"));
    expect(approvePending).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("copilot-hitl-reject"));
    expect(rejectPending).toHaveBeenCalledTimes(1);
  });

  it("shows the remaining budget on a 429 error", () => {
    hookState = state({
      error: {
        kind: "budget",
        message: "The tenant AI budget is exhausted.",
        retryable: false,
        remainingTokens: 0,
      },
      budget: null,
    });
    render(<CopilotPage />);

    expect(screen.getByTestId("copilot-error")).toHaveTextContent("Remaining AI budget: 0 tokens");
  });

  it("offers cancel while a response is streaming", () => {
    hookState = state({ status: "streaming" });
    render(<CopilotPage />);

    fireEvent.click(screen.getByTestId("copilot-cancel"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized message before sending", () => {
    render(<CopilotPage />);

    fireEvent.change(screen.getByLabelText("Your request"), {
      target: { value: "x".repeat(8_001) },
    });

    expect(screen.getByTestId("copilot-send")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("limit is 8,000");
    expect(send).not.toHaveBeenCalled();
  });

  it("renders sessions and lets the user start a new conversation", () => {
    render(<CopilotPage />);

    expect(screen.getByTestId("copilot-sessions")).toHaveTextContent("Leave policy");
    fireEvent.click(screen.getByTestId("copilot-new-session"));
    expect(newSession).toHaveBeenCalledTimes(1);
  });
});

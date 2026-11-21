import { ApiError, type CopilotResponseDto } from "../api";
import {
  MAX_MESSAGE_LENGTH,
  approvalProposalOf,
  auditEntriesFromTurns,
  budgetLabel,
  classifyCopilotError,
  createTurn,
  isLowConfidence,
  isNoAnswer,
  lacksCitations,
  readSessions,
  redactArguments,
  storageKey,
  streamChunks,
  validateMessage,
  writeSessions,
  createSession,
  appendTurn,
} from "../copilot";

function response(overrides: Partial<CopilotResponseDto> = {}): CopilotResponseDto {
  return {
    answer: "The leave policy allows 20 days.",
    action: "knowledge_search",
    confidence: 0.9,
    requires_human_approval: false,
    tool_calls: [],
    data: null,
    model: "gpt-4o-mini",
    model_tier: "standard",
    prompt_version: "v1",
    correlation_id: "corr-1",
    idempotency_key: "idem-1",
    ...overrides,
  };
}

describe("copilot helpers", () => {
  it("rejects empty and oversized requests before any call", () => {
    expect(validateMessage("   ").ok).toBe(false);
    expect(validateMessage("x".repeat(MAX_MESSAGE_LENGTH + 1)).ok).toBe(false);
    expect(validateMessage("hello").ok).toBe(true);
  });

  it("redacts sensitive keys and PII values recursively", () => {
    const redacted = redactArguments({
      token: "abc",
      email: "ada@acme.com",
      nested: { password: "secret", note: "call +90 555 111 22 33" },
    }) as Record<string, unknown>;
    expect(redacted.token).toBe("[REDACTED]");
    // A sensitive key is redacted as a whole, so its value is never rendered.
    expect(redacted.email).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).password).toBe("[REDACTED]");
    const note = (redacted.nested as Record<string, unknown>).note as string;
    expect(note).toContain("[PII_REDACTED]");
    expect(note).not.toContain("555 111 22 33");
  });

  it("deduplicates audit entries by request key", () => {
    const first = createTurn(
      "assistant",
      "answer",
      "idem-1",
      "complete",
      1,
      "t1",
    );
    first.response = response();
    const replay = createTurn("assistant", "answer", "idem-1", "complete", 2, "t2");
    replay.response = response({ correlation_id: "corr-replayed" });

    const entries = auditEntriesFromTurns([first, replay]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.requestId).toBe("idem-1");
  });

  it("extracts structured approval proposals only from proposal data", () => {
    const proposal = approvalProposalOf(
      response({
        action: "approval_assistance",
        data: {
          proposalId: "p-1",
          proposalHash: "a".repeat(64),
          workflowInstanceId: "inst-1",
          proposedAction: "create_approval",
          expiresAt: 123,
        },
      }),
    );
    expect(proposal).toEqual({
      proposalId: "p-1",
      proposalHash: "a".repeat(64),
      workflowInstanceId: "inst-1",
      proposedAction: "create_approval",
      expiresAt: 123,
    });
    expect(approvalProposalOf(response())).toBeNull();
  });

  it("flags no-answer, low-confidence and missing citations", () => {
    expect(isNoAnswer(response({ answer: "I don't know. No document.", outcome: "NO_ANSWER" }))).toBe(
      true,
    );
    expect(isLowConfidence(response({ outcome: "LOW_CONFIDENCE", confidence: 0.2 }))).toBe(true);
    expect(lacksCitations(response({ citations: [] }))).toBe(true);
    expect(
      lacksCitations(
        response({
          citations: [
            { index: 1, title: "Policy", document_id: "file-1", chunk_index: 0, score: 0.9 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("describes remaining budget or explicitly reports that it is unknown", () => {
    expect(budgetLabel(null)).toContain("not reported");
    expect(
      budgetLabel({
        remaining_tokens: 900,
        monthly_budget_tokens: 1000,
        used_tokens: 100,
        estimated_cost_micros: 20,
      }),
    ).toContain("Remaining AI budget: 900 tokens");
  });

  it("classifies a budget 429 with the remaining amount", () => {
    const info = classifyCopilotError(
      new ApiError(429, "AI budget exhausted. Remaining tokens: 0.", "corr-1", 30),
    );
    expect(info.kind).toBe("budget");
    expect(info.remainingTokens).toBe(0);
    expect(info.retryable).toBe(false);
  });

  it("classifies timeout, network and session errors", () => {
    expect(classifyCopilotError(new ApiError(504, "timeout")).kind).toBe("timeout");
    expect(classifyCopilotError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(classifyCopilotError(new ApiError(401, "Unauthorized")).kind).toBe("session");
  });

  it("emits the first streaming chunk immediately when no interval is configured", () => {
    const chunks = streamChunks("The leave policy allows twenty days of annual leave.", 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe("The leave policy allows twenty days of annual leave.");
  });

  it("scopes conversation storage by tenant", () => {
    const keyA = storageKey("tenant-a", null);
    const keyB = storageKey("tenant-b", null);
    expect(keyA).not.toBe(keyB);

    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const session = appendTurn(createSession(1, "s1"), createTurn("user", "hi", "r1", "complete", 1, "t1"));
    writeSessions(storage, keyA, [session]);

    expect(readSessions(storage, keyA)).toHaveLength(1);
    expect(readSessions(storage, keyB)).toEqual([]);
  });

  it("ignores malformed persisted history", () => {
    const storage = { getItem: () => "{not-json" };
    expect(readSessions(storage, "key")).toEqual([]);
  });
});

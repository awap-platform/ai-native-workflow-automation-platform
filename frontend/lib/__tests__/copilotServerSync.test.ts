import type { CopilotSessionThreadDto, CopilotTurnDto } from "../api";
import type { CopilotTurn } from "../copilot";
import {
  isEmptyPage,
  mergeSessions,
  mergeTurns,
  pendingApprovals,
  toLocalSession,
} from "../copilotServerSync";

function turn(id: string, createdAt: number, text = id): CopilotTurn {
  return { id, role: "user", text, createdAt, requestId: id, status: "complete" };
}

function serverTurn(id: string, sequence: number, createdAt: string): CopilotTurnDto {
  return {
    id,
    sequence,
    role: "assistant",
    content: `server-${id}`,
    contentHash: "a".repeat(64),
    previousHash: null,
    toolCallsJson: null,
    citationsJson: null,
    budgetJson: null,
    approvalJson: null,
    idempotencyKey: null,
    createdAt,
  };
}

function thread(overrides: Partial<CopilotSessionThreadDto> = {}): CopilotSessionThreadDto {
  return {
    id: "s1",
    title: "Leave policy",
    createdAt: "2026-11-25T10:00:00Z",
    updatedAt: "2026-11-25T10:05:00Z",
    archived: false,
    expiresAt: "2026-12-25T10:00:00Z",
    turns: [serverTurn("t2", 2, "2026-11-25T10:05:00Z")],
    hitl: [],
    ...overrides,
  };
}

describe("mergeTurns", () => {
  it("keeps the server copy for a turn that exists on both sides", () => {
    const merged = mergeTurns([turn("t1", 1, "server")], [turn("t1", 1, "local")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("server");
  });

  it("appends offline turns without duplicating them", () => {
    const merged = mergeTurns([turn("t1", 1)], [turn("t2", 2), turn("t1", 1)]);
    expect(merged.map((entry) => entry.id)).toEqual(["t1", "t2"]);
  });

  it("orders turns chronologically even when the server returns them out of order", () => {
    const merged = mergeTurns([turn("b", 2), turn("a", 1)], []);
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("mergeSessions", () => {
  it("merges turns of the same session and keeps the newest list order", () => {
    const local = [
      { id: "s1", title: "Local", createdAt: 1, updatedAt: 5, turns: [turn("t1", 1)] },
    ];
    const remote = [
      { id: "s1", title: "Server", createdAt: 1, updatedAt: 9, turns: [turn("t2", 2)] },
      { id: "s2", title: "Other", createdAt: 2, updatedAt: 8, turns: [] },
    ];

    const merged = mergeSessions(local, remote);

    expect(merged.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(merged[0]?.turns.map((entry) => entry.id)).toEqual(["t1", "t2"]);
  });
});

describe("toLocalSession", () => {
  it("maps the stored thread to the local shape", () => {
    const session = toLocalSession(thread());

    expect(session.id).toBe("s1");
    expect(session.title).toBe("Leave policy");
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]).toMatchObject({ id: "t2", role: "assistant", text: "server-t2" });
  });

  it("skips a corrupt stored turn instead of breaking the thread", () => {
    const corrupt = { ...serverTurn("bad", 1, "2026-11-25T10:00:00Z"), content: undefined };
    const session = toLocalSession(
      thread({
        turns: [corrupt as unknown as CopilotTurnDto, serverTurn("ok", 2, "2026-11-25T10:01:00Z")],
      }),
    );

    expect(session.turns.map((entry) => entry.id)).toEqual(["ok"]);
  });

  it("falls back to the current time when a timestamp is unparsable", () => {
    const session = toLocalSession(thread({ createdAt: "not-a-date", updatedAt: "not-a-date" }));

    expect(Number.isFinite(session.createdAt)).toBe(true);
    expect(Number.isFinite(session.updatedAt)).toBe(true);
  });
});

describe("pendingApprovals and isEmptyPage", () => {
  it("returns only pending approvals", () => {
    const approvals = pendingApprovals(
      thread({
        hitl: [
          {
            id: "h1",
            sessionId: "s1",
            turnId: null,
            state: "PENDING",
            summary: "Approve",
            proposalJson: null,
            decidedBy: null,
            decidedAt: null,
            createdAt: "2026-11-25T10:00:00Z",
          },
          {
            id: "h2",
            sessionId: "s1",
            turnId: null,
            state: "APPROVED",
            summary: "Done",
            proposalJson: null,
            decidedBy: "u1",
            decidedAt: "2026-11-25T10:00:00Z",
            createdAt: "2026-11-25T10:00:00Z",
          },
        ],
      }),
    );

    expect(approvals.map((entry) => entry.id)).toEqual(["h1"]);
  });

  it("recognises an empty page", () => {
    expect(isEmptyPage([])).toBe(true);
    expect(
      isEmptyPage([{ id: "s1", title: "x", createdAt: "", updatedAt: "", archived: false }]),
    ).toBe(false);
  });
});

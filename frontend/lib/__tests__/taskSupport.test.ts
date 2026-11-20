import { ApiError } from "../api";
import { recordServerClock, resetServerClock, serverClockOffsetMs, serverNow } from "../serverClock";
import { clampDraft, clearDraft, DRAFT_LIMIT, loadDraft, saveDraft } from "../tasks/drafts";
import { describeTaskError, requiresReauthentication } from "../tasks/errors";
import { deleteView, listSavedViews, parseSavedViews, saveView, SAVED_VIEW_KEY } from "../tasks/savedViews";

function dateSource(value: string | null) {
  return { headers: { get: (name: string) => (name === "date" ? value : null) } };
}

describe("server clock", () => {
  afterEach(() => resetServerClock());

  it("applies the skew reported by the response Date header", () => {
    const receivedAt = Date.parse("2026-11-20T12:00:00Z");
    const offset = recordServerClock(dateSource("Fri, 20 Nov 2026 12:00:05 GMT"), receivedAt);
    expect(offset).toBe(5000);
    expect(serverNow(receivedAt)).toBe(receivedAt + 5000);
    expect(serverClockOffsetMs()).toBe(5000);
  });

  it("ignores a missing, malformed or absurd header", () => {
    const receivedAt = Date.parse("2026-11-20T12:00:00Z");
    expect(recordServerClock(dateSource(null), receivedAt)).toBe(0);
    expect(recordServerClock(dateSource("not a date"), receivedAt)).toBe(0);
    expect(recordServerClock(dateSource("Fri, 20 Nov 2027 12:00:00 GMT"), receivedAt)).toBe(0);
  });
});

describe("decision drafts", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips a draft and trims to the server limit", () => {
    saveDraft("task-1", "Needs a receipt");
    expect(loadDraft("task-1")).toBe("Needs a receipt");
    expect(clampDraft("x".repeat(DRAFT_LIMIT + 50))).toHaveLength(DRAFT_LIMIT);
  });

  it("removes the draft when the text is cleared or explicitly discarded", () => {
    saveDraft("task-2", "draft");
    saveDraft("task-2", "");
    expect(loadDraft("task-2")).toBe("");
    saveDraft("task-3", "draft");
    clearDraft("task-3");
    expect(loadDraft("task-3")).toBe("");
  });

  it("keeps Turkish characters and emoji intact", () => {
    const text = "Tutarlar hatalı — şğüöçı ✅";
    saveDraft("task-4", text);
    expect(loadDraft("task-4")).toBe(text);
  });
});

describe("saved views", () => {
  beforeEach(() => window.localStorage.clear());

  it("saves, replaces by name and deletes views", () => {
    saveView("Overdue", { filter: "overdue", search: "", sort: "sla" });
    saveView("Mine", { filter: "mine", search: "expense", sort: "created" });
    let views = saveView("Overdue", { filter: "overdue", search: "late", sort: "sla" });
    expect(views).toHaveLength(2);
    expect(views[0]?.query.search).toBe("late");
    views = deleteView(views[0]!.id);
    expect(views).toHaveLength(1);
    expect(views[0]?.name).toBe("Mine");
  });

  it("ignores corrupt storage", () => {
    window.localStorage.setItem(SAVED_VIEW_KEY, "not json");
    expect(listSavedViews()).toEqual([]);
    expect(parseSavedViews(JSON.stringify([{ id: 1, name: "bad" }]))).toEqual([]);
  });
});

describe("task error classification", () => {
  it("turns a 409 into a human conflict message", () => {
    const description = describeTaskError(new ApiError(409, "conflict", "corr-1"));
    expect(description.kind).toBe("conflict");
    expect(description.messageKey).toBe("tasks.error.conflict");
    expect(description.retryable).toBe(false);
    expect(description.correlationId).toBe("corr-1");
  });

  it("keeps 403 as a permission failure that needs re-authentication", () => {
    const description = describeTaskError(new ApiError(403, "forbidden"));
    expect(requiresReauthentication(description)).toBe(true);
    expect(description.retryable).toBe(false);
  });

  it("marks 429 and 5xx as retryable and keeps Retry-After", () => {
    const limited = describeTaskError(new ApiError(429, "slow down", undefined, 60));
    expect(limited.retryAfterSeconds).toBe(60);
    expect(limited.retryable).toBe(true);
    expect(describeTaskError(new ApiError(503, "down")).kind).toBe("unavailable");
  });

  it("maps a network failure to offline and a 404 to gone", () => {
    expect(describeTaskError(new TypeError("Failed to fetch")).kind).toBe("offline");
    expect(describeTaskError(new ApiError(404, "missing")).kind).toBe("gone");
    expect(describeTaskError("boom").kind).toBe("unknown");
  });
});

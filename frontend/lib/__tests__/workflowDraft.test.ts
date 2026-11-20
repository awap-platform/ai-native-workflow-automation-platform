import type { WorkflowEdge, WorkflowNode } from "../workflowGraph";
import {
  AUTOSAVE_DELAY_MS,
  DRAFT_STORAGE_PREFIX,
  clearDraft,
  draftKey,
  guardNavigation,
  loadDraft,
  parseDraft,
  requestUnloadGuard,
  saveDraft,
  serializeDraft,
  shouldAutosave,
  type DraftStorage,
} from "../workflowDraft";

function node(id: string, type = "TASK"): WorkflowNode {
  return { id, type: "workflow", position: { x: 1, y: 2 }, data: { type, name: `${type} ${id}` } };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target, data: { condition: "#amount > 1" } };
}

function memoryStorage(): DraftStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("designer draft autosave", () => {
  it("round-trips a draft through storage and restores it on reload", () => {
    const storage = memoryStorage();
    const key = draftKey("tenant-a");
    const draft = {
      name: "Expense flow",
      nodes: [node("a", "START"), node("b")],
      edges: [edge("e1", "a", "b")],
      definitionId: "def-1",
    };

    expect(saveDraft(storage, key, draft)).toBe(true);
    expect(key).toBe(`${DRAFT_STORAGE_PREFIX}tenant-a`);

    const restored = loadDraft(storage, key);
    expect(restored).toMatchObject(draft);
    expect(restored?.savedAt).toEqual(expect.any(String));
  });

  it("keeps tenants isolated", () => {
    const storage = memoryStorage();
    saveDraft(storage, draftKey("tenant-a"), {
      name: "A",
      nodes: [node("a")],
      edges: [],
      definitionId: null,
    });
    expect(loadDraft(storage, draftKey("tenant-b"))).toBeNull();
    expect(loadDraft(storage, draftKey(null))).toBeNull();
  });

  it("ignores corrupt or partial payloads instead of crashing", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ nodes: [] }))).toBeNull();
    expect(
      parseDraft(JSON.stringify({ name: 42, nodes: [{ id: "a", type: "workflow", position: {}, data: {} }], edges: [{}] })),
    ).toMatchObject({ name: "", edges: [] });
  });

  it("survives storage that throws (quota or disabled)", () => {
    const storage: DraftStorage = {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("disabled");
      },
    };
    expect(saveDraft(storage, "k", { name: "", nodes: [], edges: [], definitionId: null })).toBe(
      false,
    );
    expect(loadDraft(storage, "k")).toBeNull();
    expect(() => clearDraft(storage, "k")).not.toThrow();
  });

  it("serializes with a timestamp and clears the draft", () => {
    const parsed = JSON.parse(
      serializeDraft({ name: "x", nodes: [], edges: [], definitionId: null }),
    ) as { savedAt: string };
    expect(Number.isNaN(Date.parse(parsed.savedAt))).toBe(false);

    const storage = memoryStorage();
    saveDraft(storage, "k", { name: "x", nodes: [], edges: [], definitionId: null });
    clearDraft(storage, "k");
    expect(storage.getItem("k")).toBeNull();
  });

  it("only autosaves a dirty non-empty graph", () => {
    expect(shouldAutosave(false, [node("a")], [])).toBe(false);
    expect(shouldAutosave(true, [], [])).toBe(false);
    expect(shouldAutosave(true, [node("a")], [])).toBe(true);
    expect(AUTOSAVE_DELAY_MS).toBeGreaterThan(0);
  });
});

describe("unsaved-changes guards", () => {
  it("requests the before-unload prompt only when dirty", () => {
    let prevented = false;
    const event = { preventDefault: () => (prevented = true) };
    expect(requestUnloadGuard(event, false)).toBe(false);
    expect(prevented).toBe(false);
    expect(requestUnloadGuard(event, true)).toBe(true);
    expect(prevented).toBe(true);
  });

  it("asks before a same-origin in-app navigation and blocks on cancel", () => {
    const anchor = document.createElement("a");
    anchor.href = "http://localhost/instances";
    document.body.appendChild(anchor);
    const click = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: anchor,
    };
    const confirm = jest.fn(() => false);

    expect(guardNavigation(click, true, confirm, "http://localhost")).toBe("block");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(guardNavigation({ ...click, target: anchor }, false, confirm, "http://localhost")).toBe(
      "ignore",
    );
    expect(guardNavigation({ ...click, metaKey: true }, true, confirm, "http://localhost")).toBe(
      "ignore",
    );
    anchor.remove();
  });

  it("allows navigation when the user confirms and ignores external links", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.test/elsewhere";
    document.body.appendChild(anchor);
    const click = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: anchor,
    };
    expect(guardNavigation(click, true, () => false, "http://localhost")).toBe("ignore");

    anchor.href = "http://localhost/workflows";
    expect(guardNavigation(click, true, () => true, "http://localhost")).toBe("allow");
    anchor.remove();
  });
});

import type { Connection } from "@xyflow/react";

import {
  NODE_COLORS,
  NODE_TYPES,
  addConnection,
  alignNodes,
  canRedo,
  canUndo,
  connectionError,
  copySelection,
  createHistory,
  createNode,
  createsCycle,
  dropToFlowPosition,
  duplicateNode,
  pasteClipboard,
  pushHistory,
  redo,
  removeNode,
  shortcutAction,
  undo,
  validateGraph,
  validateGraphIssues,
} from "../workflowDesigner";
import { parseDefinitionJson, toDefinitionJson, type WorkflowEdge, type WorkflowNode } from "../workflowGraph";

function node(id: string, type: string, config?: Record<string, unknown>): WorkflowNode {
  return {
    id,
    type: "workflow",
    position: { x: 0, y: 0 },
    data: { type, name: type, ...(config ? { config } : {}) },
  };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target, data: {} };
}

function connection(source: string, target: string): Connection {
  return { source, target, sourceHandle: null, targetHandle: null };
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `fallback-${index}`;
}

describe("createNode", () => {
  it.each(NODE_TYPES)("creates a %s node with the palette position", (type) => {
    const created = createNode(type, { x: 12, y: 34 }, { newId: () => "node-1" });
    expect(created.id).toBe("node-1");
    expect(created.type).toBe("workflow");
    expect(created.position).toEqual({ x: 12, y: 34 });
    expect(created.data).toEqual({ type, name: type });
    expect(NODE_COLORS[type]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("regenerates an id that already exists", () => {
    const created = createNode(
      "TASK",
      { x: 0, y: 0 },
      { existingIds: ["a"], newId: ids("a", "b") },
    );
    expect(created.id).toBe("b");
  });

  it("fails instead of looping forever when every generated id collides", () => {
    expect(() =>
      createNode("TASK", { x: 0, y: 0 }, { existingIds: ["a"], newId: () => "a" }),
    ).toThrow(/unique node id/);
  });
});

describe("dropToFlowPosition", () => {
  const bounds = { left: 100, top: 100, right: 500, bottom: 400 };
  const convert = (position: { x: number; y: number }) => ({
    x: position.x - 100,
    y: position.y - 100,
  });

  it("converts a client drop to canvas coordinates", () => {
    expect(
      dropToFlowPosition({ clientX: 260, clientY: 240, bounds, screenToFlowPosition: convert }),
    ).toEqual({ x: 160, y: 140 });
  });

  it.each([
    ["left", 99, 200],
    ["right", 501, 200],
    ["above", 200, 99],
    ["below", 200, 401],
  ])("ignores a drop %s of the canvas", (_name, clientX, clientY) => {
    expect(
      dropToFlowPosition({ clientX, clientY, bounds, screenToFlowPosition: convert }),
    ).toBeNull();
  });

  it("ignores a non-finite conversion", () => {
    expect(
      dropToFlowPosition({
        clientX: 200,
        clientY: 200,
        bounds,
        screenToFlowPosition: () => ({ x: Number.NaN, y: 10 }),
      }),
    ).toBeNull();
  });
});

describe("connection validation", () => {
  const nodes = [node("start", "START"), node("task", "TASK"), node("end", "END")];

  it("detects self-loops and cycles", () => {
    expect(createsCycle([], "a", "a")).toBe(true);
    expect(createsCycle([edge("1", "a", "b")], "b", "a")).toBe(true);
    expect(createsCycle([edge("1", "a", "b")], "b", "c")).toBe(false);
    expect(createsCycle([edge("1", "a", "b"), edge("2", "c", "d")], "b", "c")).toBe(false);
  });

  it("rejects missing endpoints, unknown nodes, duplicates and cycles", () => {
    expect(
      connectionError(nodes, [], {
        source: "",
        target: "task",
        sourceHandle: null,
        targetHandle: null,
      }),
    ).toMatch(/source/);
    expect(connectionError(nodes, [], connection("ghost", "task"))).toMatch(/must exist/);
    expect(
      connectionError(nodes, [edge("1", "start", "task")], connection("start", "task")),
    ).toMatch(/already exists/);
    expect(
      connectionError(
        nodes,
        [edge("1", "start", "task"), edge("2", "task", "end")],
        connection("end", "start"),
      ),
    ).toMatch(/cycle/);
    expect(connectionError(nodes, [], connection("start", "task"))).toBeNull();
  });

  it("adds a valid connection and keeps the edges unchanged for an invalid one", () => {
    const edges = [edge("1", "start", "task")];
    const added = addConnection(nodes, edges, connection("task", "end"), () => "edge-2");
    expect(added.error).toBeNull();
    expect(added.edges).toHaveLength(2);
    expect(added.edges[1]).toMatchObject({ id: "edge-2", source: "task", target: "end" });

    const rejected = addConnection(nodes, edges, connection("task", "start"), () => "edge-3");
    expect(rejected.error).toMatch(/cycle/);
    expect(rejected.edges).toBe(edges);
  });
});

describe("removeNode and duplicateNode", () => {
  it("removes a node together with its transitions", () => {
    const result = removeNode(
      [node("a", "START"), node("b", "TASK"), node("c", "END")],
      [edge("1", "a", "b"), edge("2", "b", "c"), edge("3", "c", "b"), edge("4", "a", "c")],
      "b",
    );
    expect(result.nodes.map((candidate) => candidate.id)).toEqual(["a", "c"]);
    expect(result.edges.map((candidate) => candidate.id)).toEqual(["4"]);
  });

  it("duplicates a node with a new id, offset position and copied config", () => {
    const original = node("a", "APPROVAL", { approvers: ["role:MANAGER"], nested: { x: 1 } });
    const copy = duplicateNode([original], "a", () => "b");
    expect(copy).not.toBeNull();
    expect(copy?.id).toBe("b");
    expect(copy?.position).toEqual({ x: 40, y: 40 });
    expect(copy?.data.config).toEqual({ approvers: ["role:MANAGER"], nested: { x: 1 } });
    expect(copy?.data.config).not.toBe(original.data.config);
  });

  it("returns null for an unknown node", () => {
    expect(duplicateNode([], "ghost", () => "b")).toBeNull();
  });
});

describe("validateGraph", () => {
  it("blocks an empty graph on START and only warns about END", () => {
    const result = validateGraph([], []);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["A workflow needs exactly one START node."]);
    expect(result.errors).not.toContain("A workflow needs at least one END node.");
  });

  it("rejects duplicate START nodes", () => {
    const result = validateGraph([node("a", "START"), node("b", "START")], []);
    expect(result.errors).toContain("A workflow needs exactly one START node.");
  });

  it("rejects dangling transitions", () => {
    const result = validateGraph([node("a", "START"), node("b", "END")], [edge("1", "a", "ghost")]);
    expect(result.errors).toContain("1 transition(s) point to a missing node.");
  });

  it("rejects cycles", () => {
    const result = validateGraph(
      [node("a", "START"), node("b", "TASK"), node("c", "END")],
      [edge("1", "a", "b"), edge("2", "b", "a")],
    );
    expect(result.errors).toContain("The workflow contains a cycle.");
  });

  it("rejects nodes that are unreachable from START", () => {
    const result = validateGraph(
      [node("a", "START"), node("b", "END"), node("c", "TASK")],
      [edge("1", "a", "b")],
    );
    expect(result.errors.some((error) => error.includes("Unreachable: TASK"))).toBe(true);
  });

  it("accepts a connected START -> END flow", () => {
    const result = validateGraph(
      [node("a", "START"), node("b", "TASK"), node("c", "END")],
      [edge("1", "a", "b"), edge("2", "b", "c")],
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });
});

describe("structured validation (unhappy paths)", () => {
  it("blocks a missing START but only warns about a missing END", () => {
    const noStart = validateGraphIssues([node("e", "END")], []);
    expect(noStart.blocking).toBe(true);
    expect(noStart.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "start-missing", severity: "error" }),
      ]),
    );

    const noEnd = validateGraphIssues([node("s", "START")], []);
    expect(noEnd.blocking).toBe(false);
    expect(noEnd.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "end-missing", severity: "warning" })]),
    );
  });

  it("reports cycles and disconnected nodes with focusable ids", () => {
    const cycle = validateGraphIssues(
      [node("s", "START"), node("a", "TASK"), node("b", "TASK"), node("e", "END")],
      [edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "b", "a"), edge("4", "b", "e")],
    );
    expect(cycle.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "cycle", severity: "error" })]),
    );

    const disconnected = validateGraphIssues(
      [node("s", "START"), node("e", "END"), node("x", "TASK")],
      [edge("1", "s", "e")],
    );
    expect(disconnected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unreachable", severity: "error", nodeId: "x" }),
      ]),
    );
  });

  it("reports an invalid SpEL condition on the edge", () => {
    const invalid = validateGraphIssues(
      [node("s", "START"), node("e", "END")],
      [{ id: "bad", source: "s", target: "e", data: { condition: "#amount > (100" } }],
    );
    expect(invalid.blocking).toBe(true);
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-condition", edgeId: "bad" }),
      ]),
    );
  });
});

describe("copy, paste and alignment", () => {
  it("copies selected nodes and only the transitions between them", () => {
    const nodes = [node("a", "START"), node("b", "TASK"), node("c", "TASK")];
    const edges = [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("ac", "a", "c")];
    const clipboard = copySelection(nodes, edges, ["a", "b"], [], ids("a2", "b2", "ab2"));

    expect(clipboard.nodes.map((candidate) => candidate.id)).toEqual(["a2", "b2"]);
    expect(clipboard.edges).toHaveLength(1);
    expect(clipboard.edges[0]).toMatchObject({ source: "a2", target: "b2" });
    expect(clipboard.nodes[0]?.position).toEqual({ x: 40, y: 40 });
    expect(clipboard.nodes[0]?.data).not.toBe(nodes[0]?.data);
  });

  it("duplicates an explicitly selected transition with its endpoints", () => {
    const nodes = [node("a", "START"), node("b", "TASK")];
    const edges = [edge("ab", "a", "b")];
    const copied = copySelection(nodes, edges, [], ["ab"], () => "ab-copy");
    expect(copied.nodes).toEqual([]);
    expect(copied.edges).toHaveLength(1);
    expect(copied.edges[0]).toMatchObject({ id: "ab-copy", source: "a", target: "b" });
  });

  it("pastes with fresh ids and an offset", () => {
    const clipboard = {
      nodes: [{ ...node("a", "START"), position: { x: 10, y: 10 } }],
      edges: [],
    };
    const pasted = pasteClipboard(clipboard, [node("existing", "TASK")], { x: 5, y: 5 }, () => "new");
    expect(pasted.nodes[0]).toMatchObject({ id: "new", position: { x: 15, y: 15 } });
  });

  it.each([
    ["left", "x", { x: 0, y: 0 }, { x: 0, y: 10 }],
    ["right", "x", { x: 0, y: 0 }, { x: 10, y: 10 }],
    ["top", "y", { x: 0, y: 0 }, { x: 10, y: 0 }],
    ["bottom", "y", { x: 0, y: 0 }, { x: 10, y: 10 }],
  ] as const)("aligns nodes to %s", (mode, axis, first, second) => {
    const nodes = [
      { ...node("a", "TASK"), position: first },
      { ...node("b", "TASK"), position: second },
    ];
    const aligned = alignNodes(nodes, ["a", "b"], mode);
    expect(aligned[0]?.position[axis]).toEqual(aligned[1]?.position[axis]);
  });

  it("centres and middles nodes on the selection bounding box", () => {
    const nodes = [
      { ...node("a", "TASK"), position: { x: 0, y: 0 } },
      { ...node("b", "TASK"), position: { x: 10, y: 10 } },
    ];
    const centred = alignNodes(nodes, ["a", "b"], "center");
    expect(centred[0]?.position.x).toBe(5);
    expect(centred[1]?.position.x).toBe(5);
    const middled = alignNodes(nodes, ["a", "b"], "middle");
    expect(middled[0]?.position.y).toBe(5);
    expect(middled[1]?.position.y).toBe(5);
  });

  it("maps copy and paste shortcuts, including the clipboard gate", () => {
    expect(shortcutAction({ key: "c", ctrlKey: true }, { node: true, edge: false })).toBe("copy");
    expect(
      shortcutAction({ key: "v", ctrlKey: true }, { node: false, edge: false, clipboard: false }),
    ).toBeNull();
    expect(
      shortcutAction({ key: "v", ctrlKey: true }, { node: false, edge: false, clipboard: true }),
    ).toBe("paste");
  });
});

describe("definition round-trip (T5-01)", () => {
  it("serializes and parses nodes, configs and conditions deep-equal", () => {
    const nodes = [
      { ...node("s", "START"), position: { x: 1, y: 2 } },
      { ...node("t", "APPROVAL", { approvers: ["role:MANAGER"] }), position: { x: 3, y: 4 } },
      node("e", "END"),
    ];
    const edges = [
      { id: "x", source: "s", target: "t", data: {} },
      { id: "y", source: "t", target: "e", data: { condition: "#amount > 1" } },
    ];
    const parsed = parseDefinitionJson(toDefinitionJson(nodes, edges));
    expect(parsed.nodes.map((candidate) => candidate.data)).toEqual(
      nodes.map((candidate) => candidate.data),
    );
    expect(parsed.edges.map((candidate) => candidate.data)).toEqual(
      edges.map((candidate) => candidate.data),
    );
  });
});

describe("history", () => {
  const empty = { nodes: [], edges: [] };
  it("survives twenty undo and redo cycles (T5-04)", () => {
    let history = createHistory(empty);
    for (let index = 1; index <= 20; index += 1) {
      history = pushHistory(history, { nodes: [node(`n${index}`, "TASK")], edges: [] }, 100);
    }
    expect(history.index).toBe(20);
    for (let step = 0; step < 20; step += 1) {
      const undone = undo(history);
      history = undone.history;
      const expected = step === 19 ? undefined : `n${19 - step}`;
      expect(undone.snapshot.nodes[0]?.id).toBe(expected);
    }
    for (let step = 0; step < 20; step += 1) {
      history = redo(history).history;
    }
    expect(history.index).toBe(20);
    expect(history.snapshots[history.index]?.nodes[0]?.id).toBe("n20");
  });
  const one = { nodes: [node("a", "START")], edges: [] };
  const two = { nodes: [node("a", "START"), node("b", "END")], edges: [] };

  it("walks snapshots with undo and redo", () => {
    let history = createHistory(empty);
    history = pushHistory(history, one);
    history = pushHistory(history, two);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    const undone = undo(history);
    expect(undone.snapshot).toEqual(one);
    expect(canRedo(undone.history)).toBe(true);

    const redone = redo(undone.history);
    expect(redone.snapshot).toEqual(two);
  });

  it("does not move past the first or last snapshot", () => {
    let history = createHistory(empty);
    expect(canUndo(history)).toBe(false);
    expect(undo(history).snapshot).toEqual(empty);
    expect(redo(history).snapshot).toEqual(empty);

    history = pushHistory(history, one);
    expect(redo(history).snapshot).toEqual(one);
  });

  it("skips no-op snapshots and drops the redo tail after a new edit", () => {
    let history = createHistory(empty);
    history = pushHistory(history, one);
    const unchanged = pushHistory(history, one);
    expect(unchanged).toBe(history);

    history = pushHistory(history, two);
    history = undo(history).history;
    history = pushHistory(history, { nodes: [node("c", "END")], edges: [] });
    expect(canRedo(history)).toBe(false);
    expect(history.snapshots).toHaveLength(3);
  });

  it("trims the oldest snapshots beyond the limit", () => {
    let history = createHistory(empty);
    for (let index = 0; index < 5; index++) {
      history = pushHistory(history, { nodes: [node(`${index}`, "TASK")], edges: [] }, 3);
    }
    expect(history.snapshots).toHaveLength(3);
    expect(history.index).toBe(2);
  });
});

describe("shortcutAction", () => {
  const selection = { node: true, edge: false };

  it("maps undo, redo, duplicate and delete", () => {
    expect(shortcutAction({ key: "z", ctrlKey: true }, selection)).toBe("undo");
    expect(shortcutAction({ key: "z", metaKey: true }, selection)).toBe("undo");
    expect(shortcutAction({ key: "Z", ctrlKey: true, shiftKey: true }, selection)).toBe("redo");
    expect(shortcutAction({ key: "y", ctrlKey: true }, selection)).toBe("redo");
    expect(shortcutAction({ key: "d", metaKey: true }, { node: false, edge: true })).toBe(
      "duplicate",
    );
    expect(shortcutAction({ key: "Delete" }, selection)).toBe("delete");
    expect(shortcutAction({ key: "Backspace" }, { node: false, edge: true })).toBe("delete");
  });

  it("ignores shortcuts without a selection or without a modifier", () => {
    expect(shortcutAction({ key: "d", ctrlKey: true }, { node: false, edge: false })).toBeNull();
    expect(shortcutAction({ key: "z" }, selection)).toBeNull();
    expect(shortcutAction({ key: "Delete" }, { node: false, edge: false })).toBeNull();
    expect(shortcutAction({ key: "x", ctrlKey: true }, selection)).toBeNull();
  });
});

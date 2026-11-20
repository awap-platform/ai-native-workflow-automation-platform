import type { Connection } from "@xyflow/react";

import { conditionOf, type WorkflowEdge, type WorkflowNode } from "./workflowGraph";
import { validateExpression } from "./workflowExpressions";

/** Every node type the palette offers (issue #198). */
export const NODE_TYPES = [
  "START",
  "END",
  "FORM",
  "APPROVAL",
  "TASK",
  "DECISION",
  "CONDITION",
  "PARALLEL_GATEWAY",
  "MERGE_GATEWAY",
  "DELAY",
  "WEBHOOK",
  "SUB_PROCESS",
  "AI",
  "AI_TASK",
  "SCRIPT",
] as const;

export type WorkflowNodeType = (typeof NODE_TYPES)[number];

/** Palette colours. The designer darkens them for the white button label. */
export const NODE_COLORS: Record<string, string> = {
  START: "#16a34a",
  END: "#e11d48",
  FORM: "#2563eb",
  APPROVAL: "#f59e0b",
  TASK: "#8b5cf6",
  DECISION: "#0ea5e9",
  CONDITION: "#06b6d4",
  PARALLEL_GATEWAY: "#7c3aed",
  MERGE_GATEWAY: "#a855f7",
  DELAY: "#f97316",
  WEBHOOK: "#dc2626",
  SUB_PROCESS: "#475569",
  AI: "#10b981",
  AI_TASK: "#0f766e",
  SCRIPT: "#65a30d",
};

/** MIME type used by the palette drag source and the canvas drop target. */
export const NODE_DRAG_MIME = "application/x-awap-node";

export interface GraphSnapshot {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface GraphHistory {
  snapshots: GraphSnapshot[];
  index: number;
}

export interface GraphValidation {
  valid: boolean;
  errors: string[];
}

export type ValidationSeverity = "error" | "warning";

/** A single validation finding. `nodeId`/`edgeId` make the panel able to focus the canvas. */
export interface GraphIssue {
  id: string;
  severity: ValidationSeverity;
  code:
    | "start-missing"
    | "start-duplicate"
    | "end-missing"
    | "dangling-transition"
    | "cycle"
    | "unreachable"
    | "invalid-condition";
  message: string;
  nodeId?: string | undefined;
  edgeId?: string | undefined;
}

export interface GraphIssueReport {
  /** Errors block saving; warnings are informational. */
  blocking: boolean;
  issues: GraphIssue[];
}

export interface DropCoordinates {
  clientX: number;
  clientY: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
}

function cloneNodeData(node: WorkflowNode): WorkflowNode["data"] {
  const config = node.data.config;
  return {
    ...node.data,
    // Node config is JSON-serialisable (it round-trips through the definition JSON),
    // and JSON copying also works in the jsdom test environment.
    ...(config ? { config: JSON.parse(JSON.stringify(config)) as Record<string, unknown> } : {}),
  };
}

function nextId(existing: Set<string>, factory: () => string): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = factory();
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not generate a unique node id.");
}

/**
 * Creates a designer node. A generated id that already exists is regenerated, so
 * duplicated nodes and concurrent palette drops never collide.
 */
export function createNode(
  type: string,
  position: { x: number; y: number },
  options: { existingIds?: Iterable<string>; newId?: () => string } = {},
): WorkflowNode {
  const existing = new Set(options.existingIds ?? []);
  const factory = options.newId ?? (() => crypto.randomUUID());
  return {
    id: nextId(existing, factory),
    type: "workflow",
    position,
    data: { type, name: type },
  };
}

/**
 * Converts a drop event to canvas coordinates. Drops outside the canvas bounds are
 * ignored (null) instead of creating an unreachable node.
 */
export function dropToFlowPosition({
  clientX,
  clientY,
  bounds,
  screenToFlowPosition,
}: DropCoordinates) {
  const insideCanvas =
    clientX >= bounds.left &&
    clientX <= bounds.right &&
    clientY >= bounds.top &&
    clientY <= bounds.bottom;
  if (!insideCanvas) {
    return null;
  }
  const position = screenToFlowPosition({ x: clientX, y: clientY });
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return null;
  }
  return position;
}

/** True when adding source -> target would close a cycle (self-loops included). */
export function createsCycle(edges: WorkflowEdge[], source: string, target: string): boolean {
  if (source === target) {
    return true;
  }
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.source) ?? [];
    outgoing.push(edge.target);
    adjacency.set(edge.source, outgoing);
  }
  const pending = [target];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (current === source) {
      return true;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

/** Returns a human-readable reason why the connection is invalid, or null when it is valid. */
export function connectionError(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  connection: Connection,
): string | null {
  const source = connection.source;
  const target = connection.target;
  if (!source || !target) {
    return "Both a source and a target node are required.";
  }
  if (!nodes.some((node) => node.id === source) || !nodes.some((node) => node.id === target)) {
    return "Both transition endpoints must exist.";
  }
  if (edges.some((edge) => edge.source === source && edge.target === target)) {
    return "This transition already exists.";
  }
  if (createsCycle(edges, source, target)) {
    return "This transition would create a cycle.";
  }
  return null;
}

/**
 * Adds a connection when it is valid; an invalid one leaves the edges unchanged and
 * returns the error so the designer can announce it.
 */
export function addConnection(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  connection: Connection,
  newEdgeId: () => string = () => crypto.randomUUID(),
): { edges: WorkflowEdge[]; error: string | null } {
  const error = connectionError(nodes, edges, connection);
  if (error !== null) {
    return { edges, error };
  }
  return {
    edges: [...edges, { ...connection, id: newEdgeId(), data: {} }],
    error: null,
  };
}

/** Removes a node and every transition attached to it. */
export function removeNode(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  nodeId: string,
): GraphSnapshot {
  return {
    nodes: nodes.filter((node) => node.id !== nodeId),
    edges: edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
}

/** Duplicates a node with a regenerated id and an offset position. */
export function duplicateNode(
  nodes: WorkflowNode[],
  nodeId: string,
  newId: () => string = () => crypto.randomUUID(),
): WorkflowNode | null {
  const original = nodes.find((node) => node.id === nodeId);
  if (!original) {
    return null;
  }
  return {
    ...original,
    id: nextId(new Set(nodes.map((node) => node.id)), newId),
    position: { x: original.position.x + 40, y: original.position.y + 40 },
    selected: false,
    data: cloneNodeData(original),
  };
}

/**
 * Validates the graph before saving: exactly one START, at least one END, no
 * cycles, no dangling transitions and no node that is unreachable from START.
 */
export function validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): GraphValidation {
  const report = validateGraphIssues(nodes, edges);
  return {
    valid: !report.blocking,
    errors: report.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.message),
  };
}

/** True when the directed graph contains a cycle (self-loops included). */
function hasDirectedCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.source) ?? [];
    outgoing.push(edge.target);
    adjacency.set(edge.source, outgoing);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return true;
    }
    if (visited.has(id)) {
      return false;
    }
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return nodes.some((node) => visit(node.id));
}

/**
 * Structured validation used by the validation panel and the save guard.
 *
 * A missing or duplicated START is a blocking error, a missing END is only a warning, and cycles,
 * unreachable nodes and invalid edge conditions are reported as errors. Every issue carries the
 * node or transition id so clicking it can focus the canvas.
 */
export function validateGraphIssues(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): GraphIssueReport {
  const issues: GraphIssue[] = [];
  const starts = nodes.filter((node) => node.data.type === "START");
  const ends = nodes.filter((node) => node.data.type === "END");
  if (starts.length === 0) {
    issues.push({
      id: "start-missing",
      severity: "error",
      code: "start-missing",
      message: "A workflow needs exactly one START node.",
    });
  } else if (starts.length > 1) {
    issues.push({
      id: "start-duplicate",
      severity: "error",
      code: "start-duplicate",
      message: "A workflow needs exactly one START node.",
      nodeId: starts[0]?.id,
    });
  }
  if (ends.length === 0) {
    issues.push({
      id: "end-missing",
      severity: "warning",
      code: "end-missing",
      message: "A workflow needs at least one END node. An instance cannot finish without one.",
    });
  }

  const ids = new Set(nodes.map((node) => node.id));
  const dangling = edges.filter((edge) => !ids.has(edge.source) || !ids.has(edge.target));
  for (const edge of dangling) {
    issues.push({
      id: `dangling-${edge.id}`,
      severity: "error",
      code: "dangling-transition",
      message: "A transition points to a node that is no longer on the canvas.",
      edgeId: edge.id,
    });
  }
  if (dangling.length > 0) {
    issues.push({
      id: "dangling",
      severity: "error",
      code: "dangling-transition",
      message: `${dangling.length} transition(s) point to a missing node.`,
    });
  }

  if (hasDirectedCycle(nodes, edges)) {
    issues.push({
      id: "cycle",
      severity: "error",
      code: "cycle",
      message: "The workflow contains a cycle.",
    });
  }

  for (const edge of edges) {
    if (!validateExpression(conditionOf(edge)).valid) {
      issues.push({
        id: `condition-${edge.id}`,
        severity: "error",
        code: "invalid-condition",
        message: "A transition condition is invalid.",
        edgeId: edge.id,
      });
    }
  }

  const start = starts.length === 1 ? starts[0] : undefined;
  if (start) {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const outgoing = adjacency.get(edge.source) ?? [];
      outgoing.push(edge.target);
      adjacency.set(edge.source, outgoing);
    }
    const reachable = new Set<string>([start.id]);
    const pending = [start.id];
    while (pending.length > 0) {
      const current = pending.pop() as string;
      for (const next of adjacency.get(current) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          pending.push(next);
        }
      }
    }
    const unreachable = nodes.filter((node) => !reachable.has(node.id));
    if (unreachable.length > 0) {
      const labels = unreachable.map((node) => node.data.name ?? node.data.type).join(", ");
      issues.push({
        id: "unreachable",
        severity: "error",
        code: "unreachable",
        message: `Every node must be reachable from START. Unreachable: ${labels}.`,
        nodeId: unreachable[0]?.id,
      });
    }
  }

  return { blocking: issues.some((issue) => issue.severity === "error"), issues };
}

export interface GraphClipboard {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/**
 * Copies the selected nodes and the transitions whose endpoints are both selected. New ids are
 * generated immediately so repeated pastes never collide with the source selection.
 */
export function copySelection(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  selectedNodeIds: Iterable<string>,
  selectedEdgeIds: Iterable<string> = [],
  newId: () => string = () => crypto.randomUUID(),
): GraphClipboard {
  const selected = new Set(selectedNodeIds);
  const explicitEdges = new Set(selectedEdgeIds);
  const idMap = new Map<string, string>();
  const existing = new Set(nodes.map((node) => node.id));
  const copiedNodes = nodes
    .filter((node) => selected.has(node.id))
    .map((node) => {
      const id = nextId(existing, newId);
      existing.add(id);
      idMap.set(node.id, id);
      return {
        ...node,
        id,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        selected: false,
        data: cloneNodeData(node),
      };
    });
  const copiedEdges = edges.flatMap((edge) => {
    const clone = {
      ...edge,
      id: nextId(existing, newId),
      selected: false,
      data: { ...edge.data },
    };
    // An explicitly selected transition keeps its endpoints (a parallel edge), while a
    // transition copied with both endpoints is remapped onto the copied nodes.
    if (explicitEdges.has(edge.id)) {
      return [clone];
    }
    if (!selected.has(edge.source) || !selected.has(edge.target)) {
      return [];
    }
    return [
      {
        ...clone,
        source: idMap.get(edge.source) ?? edge.source,
        target: idMap.get(edge.target) ?? edge.target,
      },
    ];
  });
  return { nodes: copiedNodes, edges: copiedEdges };
}

/** Pastes a clipboard snapshot with fresh ids and an additional offset. */
export function pasteClipboard(
  clipboard: GraphClipboard,
  existingNodes: WorkflowNode[],
  offset: { x: number; y: number } = { x: 24, y: 24 },
  newId: () => string = () => crypto.randomUUID(),
): GraphClipboard {
  const existing = new Set(existingNodes.map((node) => node.id));
  const idMap = new Map<string, string>();
  const nodes = clipboard.nodes.map((node) => {
    const id = nextId(existing, newId);
    existing.add(id);
    idMap.set(node.id, id);
    return {
      ...node,
      id,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      selected: false,
      data: cloneNodeData(node),
    };
  });
  const edges = clipboard.edges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (source === undefined || target === undefined) {
      return [];
    }
    return [{ ...edge, id: nextId(existing, newId), source, target, selected: false, data: { ...edge.data } }];
  });
  return { nodes, edges };
}

export type AlignmentMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Aligns the selected nodes against the first selected node (or their bounding box). */
export function alignNodes(
  nodes: WorkflowNode[],
  selectedIds: Iterable<string>,
  mode: AlignmentMode,
): WorkflowNode[] {
  const selected = new Set(selectedIds);
  const targets = nodes.filter((node) => selected.has(node.id));
  if (targets.length < 2) {
    return nodes;
  }
  const left = Math.min(...targets.map((node) => node.position.x));
  const right = Math.max(...targets.map((node) => node.position.x));
  const top = Math.min(...targets.map((node) => node.position.y));
  const bottom = Math.max(...targets.map((node) => node.position.y));
  const center = (left + right) / 2;
  const middle = (top + bottom) / 2;
  return nodes.map((node) => {
    if (!selected.has(node.id)) {
      return node;
    }
    switch (mode) {
      case "left":
        return { ...node, position: { ...node.position, x: left } };
      case "center":
        return { ...node, position: { ...node.position, x: center } };
      case "right":
        return { ...node, position: { ...node.position, x: right } };
      case "top":
        return { ...node, position: { ...node.position, y: top } };
      case "middle":
        return { ...node, position: { ...node.position, y: middle } };
      case "bottom":
        return { ...node, position: { ...node.position, y: bottom } };
      default:
        return node;
    }
  });
}

export function createHistory(initial: GraphSnapshot): GraphHistory {
  return { snapshots: [initial], index: 0 };
}

function sameSnapshot(left: GraphSnapshot, right: GraphSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Pushes a snapshot, dropping the redo tail and skipping no-op snapshots. */
export function pushHistory(
  history: GraphHistory,
  snapshot: GraphSnapshot,
  limit = 50,
): GraphHistory {
  const current = history.snapshots[history.index];
  if (current && sameSnapshot(current, snapshot)) {
    return history;
  }
  const snapshots = [...history.snapshots.slice(0, history.index + 1), snapshot];
  const trimmed = snapshots.length > limit ? snapshots.slice(snapshots.length - limit) : snapshots;
  return { snapshots: trimmed, index: trimmed.length - 1 };
}

export function canUndo(history: GraphHistory): boolean {
  return history.index > 0;
}

export function canRedo(history: GraphHistory): boolean {
  return history.index < history.snapshots.length - 1;
}

export function undo(history: GraphHistory): { history: GraphHistory; snapshot: GraphSnapshot } {
  const index = canUndo(history) ? history.index - 1 : history.index;
  return {
    history: { ...history, index },
    snapshot: history.snapshots[index] as GraphSnapshot,
  };
}

export function redo(history: GraphHistory): { history: GraphHistory; snapshot: GraphSnapshot } {
  const index = canRedo(history) ? history.index + 1 : history.index;
  return {
    history: { ...history, index },
    snapshot: history.snapshots[index] as GraphSnapshot,
  };
}

export type DesignerShortcut = "undo" | "redo" | "duplicate" | "delete" | "copy" | "paste";

/**
 * Maps a keyboard event to a designer action. It is pure so the page only wires the
 * handler and every shortcut branch is unit-tested.
 */
export function shortcutAction(
  event: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
  selection: { node: boolean; edge: boolean; clipboard?: boolean },
): DesignerShortcut | null {
  const modifier = event.ctrlKey === true || event.metaKey === true;
  const key = event.key.toLowerCase();
  if (modifier && key === "z") {
    return event.shiftKey === true ? "redo" : "undo";
  }
  if (modifier && key === "y") {
    return "redo";
  }
  if (modifier && key === "c" && (selection.node || selection.edge)) {
    return "copy";
  }
  if (modifier && key === "v" && selection.clipboard === true) {
    return "paste";
  }
  if (modifier && key === "d" && (selection.node || selection.edge)) {
    return "duplicate";
  }
  if ((key === "delete" || key === "backspace") && (selection.node || selection.edge)) {
    return "delete";
  }
  return null;
}

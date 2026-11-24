import type { Edge, Node } from "@xyflow/react";

/** A single diagram-interchange point in flow coordinates. */
export interface DiagramPoint {
  x: number;
  y: number;
}

/** Optional visual metadata for a node. The engine never interprets this geometry. */
export interface NodeDiagram extends DiagramPoint {
  width: number;
  height: number;
  laneId?: string;
  poolId?: string;
}

/** Optional visual metadata for a transition. Waypoints are ordered source -> target. */
export interface TransitionDiagram {
  waypoints: DiagramPoint[];
  labelPosition?: DiagramPoint;
}

/** Node payload used by the designer (mirrors `WorkflowNodeData` in the designer page). */
export type WorkflowNodeData = {
  type: string;
  name?: string;
  config?: Record<string, unknown>;
  /** Lane/pool membership is visual metadata, not execution semantics. */
  di?: Pick<NodeDiagram, "laneId" | "poolId">;
};

/** Edge payload. The condition is stored verbatim so copy/paste and reloads never rewrite it. */
export type WorkflowEdgeData = Record<string, unknown> & {
  condition?: string;
  di?: TransitionDiagram;
};

export type WorkflowNode = Node<WorkflowNodeData>;
export type WorkflowEdge = Edge<WorkflowEdgeData>;

export interface SerializedTransition {
  id: string;
  from: string;
  to: string;
  condition?: string;
  di?: TransitionDiagram;
}

export interface ParsedWorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function normalizePoint(value: unknown): DiagramPoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === null || y === null ? null : { x, y };
}

function normalizeNodeDiagram(value: unknown): NodeDiagram | null {
  if (!isRecord(value)) {
    return null;
  }
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = positiveNumber(value.width);
  const height = positiveNumber(value.height);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  const laneId = asString(value.laneId);
  const poolId = asString(value.poolId);
  return {
    x,
    y,
    width,
    height,
    ...(laneId && laneId.trim() !== "" ? { laneId } : {}),
    ...(poolId && poolId.trim() !== "" ? { poolId } : {}),
  };
}

function normalizeTransitionDiagram(value: unknown): TransitionDiagram | null {
  if (!isRecord(value) || !Array.isArray(value.waypoints)) {
    return null;
  }
  const waypoints = value.waypoints
    .slice(0, 10_000)
    .map(normalizePoint)
    .filter((point): point is DiagramPoint => point !== null);
  const labelPosition = normalizePoint(value.labelPosition) ?? undefined;
  if (waypoints.length === 0 && !labelPosition) {
    return null;
  }
  return {
    waypoints,
    ...(labelPosition ? { labelPosition } : {}),
  };
}

function newEdgeId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `edge-${Math.random().toString(36).slice(2)}`;
}

/** Returns the exact edge condition text; a missing or non-string value is unconditional. */
export function conditionOf(
  edge: { data?: Record<string, unknown> | undefined } | null | undefined,
): string {
  const value = edge?.data?.condition;
  return typeof value === "string" ? value : "";
}

/** True when the edge carries a non-blank condition. */
export function isConditional(
  edge: { data?: Record<string, unknown> | undefined } | null | undefined,
): boolean {
  return conditionOf(edge).trim() !== "";
}

/** Returns a copy of the edge with the condition stored verbatim (no trimming). */
export function withCondition(edge: WorkflowEdge, condition: string): WorkflowEdge {
  return { ...edge, data: { ...edge.data, condition } };
}

/**
 * Serializes the designer graph to the workflow-definition JSON consumed by the backend.
 *
 * The condition text is emitted verbatim and omitted when blank, so an unconditional transition
 * never grows a `condition` key and a conditional transition keeps its exact spelling.
 */
export function toDefinitionJson(nodes: WorkflowNode[], edges: WorkflowEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => {
      const config = node.data.config;
      const measuredWidth = positiveNumber(node.measured?.width) ?? positiveNumber(node.width);
      const measuredHeight = positiveNumber(node.measured?.height) ?? positiveNumber(node.height);
      const x = finiteNumber(node.position?.x) ?? 80;
      const y = finiteNumber(node.position?.y) ?? 80;
      const diagram = {
        x,
        y,
        width: measuredWidth ?? 180,
        height: measuredHeight ?? 64,
        ...(node.data.di?.laneId ? { laneId: node.data.di.laneId } : {}),
        ...(node.data.di?.poolId ? { poolId: node.data.di.poolId } : {}),
      };
      return {
        id: node.id,
        type: node.data.type,
        name: node.data.name ?? node.data.type,
        ...(config && Object.keys(config).length > 0 ? { config } : {}),
        di: diagram,
      };
    }),
    transitions: edges.map((edge, index) => {
      const condition = conditionOf(edge);
      const diagram = normalizeTransitionDiagram(edge.data?.di);
      const transition: SerializedTransition = {
        id: edge.id === "" ? `transition-${index}` : edge.id,
        from: edge.source,
        to: edge.target,
        ...(condition.trim() === "" ? {} : { condition }),
        ...(diagram ? { di: diagram } : {}),
      };
      return transition;
    }),
  });
}

/**
 * Rebuilds the designer graph from a workflow-definition JSON snapshot.
 *
 * This is the reload path for conditions: transitions (or legacy `edges`) with a `condition`
 * become React Flow edges whose `data.condition` keeps the exact text.
 */
export function parseDefinitionJson(json: string): ParsedWorkflowGraph {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) {
    throw new Error("Workflow definition must contain a nodes array.");
  }

  const nodes: WorkflowNode[] = parsed.nodes.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error("Every workflow node must be an object.");
    }
    const id = asString(raw.id);
    const type = asString(raw.type);
    if (id === null || type === null) {
      throw new Error("Every workflow node needs an id and a type.");
    }
    const name = asString(raw.name);
    const config = isRecord(raw.config) ? raw.config : undefined;
    const diagram = normalizeNodeDiagram(raw.di);
    const laneId = diagram?.laneId;
    const poolId = diagram?.poolId;
    const visual =
      laneId || poolId
        ? { di: { ...(laneId ? { laneId } : {}), ...(poolId ? { poolId } : {}) } }
        : {};
    return {
      id,
      type: "workflow",
      position: diagram
        ? { x: diagram.x, y: diagram.y }
        : { x: 80 + index * 40, y: 80 + index * 40 },
      ...(diagram
        ? {
            width: diagram.width,
            height: diagram.height,
            measured: { width: diagram.width, height: diagram.height },
          }
        : {}),
      data: {
        type,
        name: name ?? type,
        ...(config ? { config } : {}),
        ...visual,
      },
    };
  });

  const rawTransitions = Array.isArray(parsed.transitions)
    ? parsed.transitions
    : Array.isArray(parsed.edges)
      ? parsed.edges
      : [];

  const edges: WorkflowEdge[] = rawTransitions.flatMap((raw, index) => {
    if (!isRecord(raw)) {
      return [];
    }
    const from = asString(raw.from);
    const to = asString(raw.to);
    if (from === null || to === null) {
      return [];
    }
    const condition = asString(raw.condition);
    const id = asString(raw.id) ?? `transition-${index}`;
    const diagram = normalizeTransitionDiagram(raw.di);
    const edge: WorkflowEdge = {
      id,
      source: from,
      target: to,
      data: {
        ...(condition === null ? {} : { condition }),
        ...(diagram ? { di: diagram } : {}),
      },
    };
    return [edge];
  });

  return { nodes, edges };
}

/** Duplicates an edge, deep-copying its data so the exact condition text survives copy/paste. */
export function duplicateEdge(edge: WorkflowEdge): WorkflowEdge {
  return {
    ...edge,
    id: newEdgeId(),
    selected: false,
    data: {
      ...edge.data,
      ...(edge.data?.di
        ? {
            di: {
              ...edge.data.di,
              waypoints: edge.data.di.waypoints.map((point) => ({ ...point })),
            },
          }
        : {}),
    },
  };
}

/**
 * Marks conditional edges with the custom `conditional` type so React Flow renders the IF badge.
 * Unconditional edges stay on the default type.
 */
export function withConditionIndicators(edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.map((edge) => ({
    ...edge,
    type: isConditional(edge) ? "conditional" : "default",
    data: { ...edge.data },
  }));
}

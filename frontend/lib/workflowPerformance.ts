import {
  addConnection,
  alignNodes,
  copySelection,
  createNode,
  validateGraphIssues,
  type GraphIssueReport,
} from "./workflowDesigner";
import { parseDefinitionJson, toDefinitionJson, type WorkflowEdge, type WorkflowNode } from "./workflowGraph";

/** The phase 5 interaction budget for a large graph. */
export const LARGE_GRAPH_BUDGET_MS = 2000;
export const LARGE_GRAPH_NODE_COUNT = 500;

export interface LargeGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/**
 * Builds a deterministic 500-node flow: one START, one END and a chain of TASK nodes with a
 * conditional edge every ten steps. Every node is reachable, so validation performs its full scan.
 */
export function buildLargeGraph(count = LARGE_GRAPH_NODE_COUNT): LargeGraph {
  if (count < 2) {
    throw new Error("A large graph needs at least a START and an END node.");
  }
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  for (let index = 0; index < count; index += 1) {
    const type = index === 0 ? "START" : index === count - 1 ? "END" : "TASK";
    const node = createNode(type, { x: (index % 20) * 180, y: Math.floor(index / 20) * 120 }, {
      newId: () => `node-${index}`,
    });
    node.data.name = `${type} ${index}`;
    nodes.push(node);
    if (index > 0) {
      edges.push({
        id: `edge-${index}`,
        source: `node-${index - 1}`,
        target: `node-${index}`,
        data: index % 10 === 0 ? { condition: "#amount > 100" } : {},
      });
    }
  }
  return { nodes, edges };
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export interface InteractionMeasurement {
  elapsedMs: number;
  budgetMs: number;
  withinBudget: boolean;
  report: GraphIssueReport;
}

/**
 * Runs the interactions the designer performs on every edit (validate, connect, copy/paste and
 * align) plus a definition JSON round-trip, and measures the wall time. The unit test asserts the
 * 500-node graph stays well below the two-second target.
 */
export function measureLargeGraphInteractions(
  graph: LargeGraph = buildLargeGraph(),
  budgetMs = LARGE_GRAPH_BUDGET_MS,
): InteractionMeasurement {
  const started = now();
  const report = validateGraphIssues(graph.nodes, graph.edges);

  const connection = addConnection(
    graph.nodes,
    graph.edges,
    { source: "node-0", target: `node-${Math.floor(graph.nodes.length / 2)}`, sourceHandle: null, targetHandle: null },
    () => "perf-connection",
  );
  const clipboard = copySelection(
    connection.edges.length > graph.edges.length ? [...graph.nodes] : graph.nodes,
    connection.edges,
    [graph.nodes[0]?.id ?? "node-0"],
    [],
    (() => {
      let index = 0;
      return () => `copy-${index++}`;
    })(),
  );
  void clipboard;
  alignNodes(graph.nodes, graph.nodes.slice(0, 20).map((node) => node.id), "left");

  const json = toDefinitionJson(graph.nodes, graph.edges);
  parseDefinitionJson(json);

  const elapsedMs = now() - started;
  return { elapsedMs, budgetMs, withinBudget: elapsedMs < budgetMs, report };
}

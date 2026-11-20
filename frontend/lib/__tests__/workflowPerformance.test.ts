import {
  LARGE_GRAPH_BUDGET_MS,
  LARGE_GRAPH_NODE_COUNT,
  buildLargeGraph,
  measureLargeGraphInteractions,
} from "../workflowPerformance";

describe("500-node designer performance (T5-09)", () => {
  it("builds the requested graph with a reachable chain", () => {
    const graph = buildLargeGraph();
    expect(graph.nodes).toHaveLength(LARGE_GRAPH_NODE_COUNT);
    expect(graph.edges).toHaveLength(LARGE_GRAPH_NODE_COUNT - 1);
    expect(graph.nodes[0]?.data.type).toBe("START");
    expect(graph.nodes[graph.nodes.length - 1]?.data.type).toBe("END");
  });

  it("validates, connects, copies, aligns and round-trips 500 nodes under two seconds", () => {
    const measurement = measureLargeGraphInteractions();
    expect(measurement.report.blocking).toBe(false);
    expect(measurement.withinBudget).toBe(true);
    expect(measurement.elapsedMs).toBeLessThan(LARGE_GRAPH_BUDGET_MS);
    // Keep the observed time visible in CI logs without turning a fast run into a flaky assertion.
    expect(measurement.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects a graph too small to contain START and END", () => {
    expect(() => buildLargeGraph(1)).toThrow(/START and an END/);
  });
});

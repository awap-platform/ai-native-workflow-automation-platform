"use client";

import { Panel, useReactFlow } from "@xyflow/react";

import type { WorkflowNode } from "../../lib/workflowGraph";

interface ProcessNavigatorProps {
  nodes: WorkflowNode[];
  selectedNodeIds: readonly string[];
  onFocusNode: (nodeId: string) => void;
}

/**
 * Process navigator (phase 5). The keyboard and screen-reader equivalent of clicking a node on the
 * canvas: the ordered list jumps to and selects a node by id.
 */
export default function ProcessNavigator({
  nodes,
  selectedNodeIds,
  onFocusNode,
}: ProcessNavigatorProps) {
  const selected = new Set(selectedNodeIds);
  return (
    <nav
      className="awap-designer__panel"
      data-testid="process-navigator"
      aria-labelledby="process-navigator-heading"
    >
      <h2 id="process-navigator-heading">Process navigator</h2>
      {nodes.length === 0 ? (
        <p className="awap-designer__hint">No nodes yet.</p>
      ) : (
        <ol className="awap-designer__nav-list">
          {nodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className="awap-designer__nav-button"
                aria-current={selected.has(node.id) ? "true" : undefined}
                onClick={() => onFocusNode(node.id)}
              >
                <span className="awap-designer__truncate">
                  {node.data.name ?? node.data.type}
                </span>{" "}
                <span className="awap-designer__hint">({node.data.type})</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

/** Mini-map plus explicit zoom/fit controls rendered inside the React Flow canvas. */
export function CanvasZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="top-right" className="awap-designer__row">
      <button type="button" aria-label="Zoom in" onClick={() => void zoomIn()}>
        Zoom in
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => void zoomOut()}>
        Zoom out
      </button>
      <button type="button" aria-label="Fit view" onClick={() => void fitView({ padding: 0.2 })}>
        Fit view
      </button>
    </Panel>
  );
}

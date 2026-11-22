"use client";

import { useState, type FormEvent } from "react";

import type { WorkflowNode } from "../../lib/workflowGraph";

interface TransitionComposerProps {
  nodes: WorkflowNode[];
  onAdd: (source: string, target: string) => void;
  error?: string | null;
}

function nodeLabel(node: WorkflowNode): string {
  return `${node.data.name ?? node.data.type} (${node.id.slice(0, 8)})`;
}

/**
 * Keyboard-only way to connect two nodes (issue 198). It mirrors the drag
 * connection so screen-reader and keyboard users never need a pointer.
 */
export default function TransitionComposer({
  nodes,
  onAdd,
  error = null,
}: TransitionComposerProps) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (source === "" || target === "") {
      return;
    }
    onAdd(source, target);
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby="transition-composer-heading"
      className="awap-transition-composer"
    >
      <h2 id="transition-composer-heading" className="awap-transition-composer__heading">
        Add a transition
      </h2>
      <label className="awap-transition-composer__field">
        From
        <select
          aria-label="Transition source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="awap-select"
        >
          <option value="">Select a node</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodeLabel(node)}
            </option>
          ))}
        </select>
      </label>
      <label className="awap-transition-composer__field">
        To
        <select
          aria-label="Transition target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className="awap-select"
        >
          <option value="">Select a node</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodeLabel(node)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={source === "" || target === ""} className="awap-button">
        Add transition
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

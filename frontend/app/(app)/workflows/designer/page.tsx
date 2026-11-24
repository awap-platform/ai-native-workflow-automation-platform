"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { errorStatus } from "../../../../lib/api";
import {
  useArchiveWorkflowVersion,
  useCreateWorkflowDefinition,
  usePublishWorkflowDefinition,
  useRollbackWorkflowDefinition,
  useUpdateWorkflowDefinition,
  useValidateWorkflowExpression,
  useWorkflowDefinition,
  useWorkflowVersions,
} from "../../../../lib/hooks/resources";
import { useActiveTenant } from "../../../../lib/hooks/useActiveTenant";
import {
  AUTOSAVE_DELAY_MS,
  clearDraft,
  draftKey,
  guardNavigation,
  loadDraft,
  requestUnloadGuard,
  saveDraft,
  shouldAutosave,
} from "../../../../lib/workflowDraft";
import {
  DEFAULT_WORKFLOW_VARIABLES,
  validateExpression,
} from "../../../../lib/workflowExpressions";
import {
  conditionOf,
  parseDefinitionJson,
  toDefinitionJson,
  withConditionIndicators,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeData,
} from "../../../../lib/workflowGraph";
import {
  NODE_DRAG_MIME,
  addConnection,
  alignNodes,
  canRedo,
  canUndo,
  connectionError,
  copySelection,
  createHistory,
  createNode,
  dropToFlowPosition,
  pasteClipboard,
  pushHistory,
  redo,
  removeNode,
  shortcutAction,
  undo,
  validateGraphIssues,
  type AlignmentMode,
  type GraphClipboard,
  type GraphHistory,
  type GraphIssue,
  type GraphSnapshot,
} from "../../../../lib/workflowDesigner";
import BpmnPanel from "../../../../components/workflows/BpmnPanel";
import ConditionalEdge from "../../../../components/workflows/ConditionalEdge";
import DesignerLegend from "../../../../components/workflows/DesignerLegend";
import EdgeConditionEditor from "../../../../components/workflows/EdgeConditionEditor";
import NodePalette from "../../../../components/workflows/NodePalette";
import NodePropertiesPanel from "../../../../components/workflows/NodePropertiesPanel";
import ProcessNavigator, {
  CanvasZoomControls,
} from "../../../../components/workflows/ProcessNavigator";
import TransitionComposer from "../../../../components/workflows/TransitionComposer";
import ValidationPanel from "../../../../components/workflows/ValidationPanel";
import { Button } from "../../../../components/ui/button";
import VersionHistoryPanel from "../../../../components/workflows/VersionHistoryPanel";

const workflowVariables = [...DEFAULT_WORKFLOW_VARIABLES];

function signatureOf(name: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): string {
  return `${name}\u0000${toDefinitionJson(nodes, edges)}`;
}

const subscribeToLocation = () => () => {};
const getLocationSearch = () => (typeof window === "undefined" ? "" : window.location.search);
const getServerLocationSearch = () => "";

function WorkflowNodeCard({ data }: { data: WorkflowNodeData }) {
  const label = data.name ?? data.type;
  return (
    <div className="awap-designer__node-card" data-node-type={data.type} title={label}>
      <Handle type="target" position={Position.Top} />
      <span className="awap-designer__truncate">{label}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNodeCard };
const edgeTypes = { conditional: ConditionalEdge };

export default function DesignerPage() {
  return (
    <ReactFlowProvider>
      <DesignerCanvas />
    </ReactFlowProvider>
  );
}

function DesignerCanvas() {
  const createWorkflow = useCreateWorkflowDefinition();
  const updateWorkflow = useUpdateWorkflowDefinition();
  const validateExpressionApi = useValidateWorkflowExpression();
  const publishWorkflow = usePublishWorkflowDefinition();
  const rollbackWorkflow = useRollbackWorkflowDefinition();
  const archiveVersion = useArchiveWorkflowVersion();
  const tenant = useActiveTenant();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [name, setName] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<GraphClipboard | null>(null);
  const [createdDefinitionId, setCreatedDefinitionId] = useState<string | null>(null);
  const [definitionRevision, setDefinitionRevision] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ currentUpdatedAt: string } | null>(null);
  const [definitionLoaded, setDefinitionLoaded] = useState(false);
  const [savedSignature, setSavedSignature] = useState(() => signatureOf("", [], []));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Validation is informational on an untouched empty canvas; it becomes authoritative after the
  // first node or a save/publish attempt (issue 361).
  const [validationTouched, setValidationTouched] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [historyFlags, setHistoryFlags] = useState({ undo: false, redo: false });

  const historyRef = useRef<GraphHistory>(createHistory({ nodes: [], edges: [] }));
  const restoredRef = useRef(false);
  const dragIntentRef = useRef<string | null>(null);

  // Hydration-safe read of ?id=: the server snapshot is empty and the client snapshot is the
  // real query string, so no effect needs to synchronise it after mount.
  const search = useSyncExternalStore(
    subscribeToLocation,
    getLocationSearch,
    getServerLocationSearch,
  );
  const urlDefinitionId = useMemo(() => new URLSearchParams(search).get("id"), [search]);
  const definitionId = createdDefinitionId ?? urlDefinitionId;

  // Only an opened definition needs a metadata lookup; a draft created in this session already
  // carries its own name and must not trigger an extra request after saving.
  const definitionQuery = useWorkflowDefinition(urlDefinitionId);
  const versionsQuery = useWorkflowVersions(definitionId);
  const versions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);

  const signature = useMemo(() => signatureOf(name, nodes, edges), [name, nodes, edges]);
  const dirty = signature !== savedSignature;
  const selectedNode =
    selectedNodeIds.length === 1
      ? (nodes.find((node) => node.id === selectedNodeIds[0]) ?? null)
      : null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const displayEdges = useMemo(() => withConditionIndicators(edges), [edges]);
  const invalidEdges = edges.filter((edge) => !validateExpression(conditionOf(edge)).valid);
  const report = useMemo(() => validateGraphIssues(nodes, edges), [nodes, edges]);

  function nodeLabel(nodeId: string): string {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    return node?.data.name ?? node?.data.type ?? nodeId;
  }

  function refreshHistoryFlags() {
    setHistoryFlags({ undo: canUndo(historyRef.current), redo: canRedo(historyRef.current) });
  }

  function applySnapshot(snapshot: GraphSnapshot) {
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
  }

  /** Applies a structural mutation and records an immutable snapshot for undo/redo. */
  function commit(nextNodes: WorkflowNode[], nextEdges: WorkflowEdge[]) {
    applySnapshot({ nodes: nextNodes, edges: nextEdges });
    historyRef.current = pushHistory(historyRef.current, { nodes: nextNodes, edges: nextEdges });
    refreshHistoryFlags();
  }

  function rememberCurrentGraph() {
    historyRef.current = pushHistory(historyRef.current, { nodes, edges });
    refreshHistoryFlags();
  }

  // Recover an autosaved draft when the page was closed or crashed (no ?id= load wins). The state
  // update is deferred one tick so the effect only reads external storage synchronously.
  useEffect(() => {
    if (!tenant || restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    if (definitionId) {
      return;
    }
    const timer = setTimeout(() => {
      const draft = loadDraft(window.localStorage, draftKey(tenant));
      if (draft && draft.nodes.length > 0) {
        setNodes(draft.nodes);
        setEdges(draft.edges);
        setName(draft.name);
        if (draft.definitionId) {
          setCreatedDefinitionId(draft.definitionId);
        }
        setNotice("Recovered an unsaved draft from this browser.");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [tenant, definitionId, setNodes, setEdges]);

  // Load the current version when the designer is opened from a saved definition.
  useEffect(() => {
    if (!definitionId || definitionLoaded || !definitionQuery.data || versions.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      const snapshot = versions.find((version) => version.current) ?? versions[0];
      if (!snapshot) {
        setDefinitionLoaded(true);
        return;
      }
      try {
        const parsed = parseDefinitionJson(snapshot.definitionJson);
        const loadedName = definitionQuery.data?.name ?? "";
        setNodes(parsed.nodes);
        setEdges(parsed.edges);
        setName(loadedName);
        setDefinitionRevision(definitionQuery.data?.updatedAt ?? null);
        setSavedSignature(signatureOf(loadedName, parsed.nodes, parsed.edges));
        setNotice(`Loaded version ${snapshot.version}.`);
      } catch {
        setError("The saved version could not be loaded into the canvas.");
      } finally {
        setDefinitionLoaded(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [definitionId, definitionLoaded, definitionQuery.data, versions, setNodes, setEdges]);

  // Autosave runs on a debounce and never blocks editing; a storage failure is silent.
  useEffect(() => {
    if (!tenant || !shouldAutosave(dirty, nodes, edges)) {
      return;
    }
    const timer = setTimeout(() => {
      const saved = saveDraft(window.localStorage, draftKey(tenant), {
        name,
        nodes,
        edges,
        definitionId,
      });
      if (saved) {
        setAutosavedAt(new Date().toISOString());
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tenant, dirty, name, nodes, edges, definitionId]);

  // Tab-close guard.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => requestUnloadGuard(event, dirty);
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // In-app navigation guard for ordinary same-origin links.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: MouseEvent) => {
      const decision = guardNavigation(
        {
          defaultPrevented: event.defaultPrevented,
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          target: event.target,
        },
        true,
        (message) => window.confirm(message),
      );
      if (decision === "block") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [dirty]);

  function addNodeAt(type: string, position: { x: number; y: number }) {
    const node = {
      ...createNode(type, position, {
        existingIds: nodes.map((candidate) => candidate.id),
      }),
      selected: true,
    };
    commit([...nodes.map((candidate) => ({ ...candidate, selected: false })), node], edges);
    setValidationTouched(true);
    setSelectedNodeIds([node.id]);
    setSelectedEdgeId(null);
    setNotice(`${type} node added.`);
  }

  function addNode(type: string) {
    const index = nodes.length;
    addNodeAt(type, { x: 80 + (index % 3) * 220, y: 80 + Math.floor(index / 3) * 140 });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    // The pointer-down type is authoritative; the data-transfer value is the fallback for drags
    // that start outside the palette.
    const type = dragIntentRef.current ?? event.dataTransfer.getData(NODE_DRAG_MIME);
    dragIntentRef.current = null;
    if (type === "") {
      setError("Drop a node type from the palette.");
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = dropToFlowPosition({
      clientX: event.clientX,
      clientY: event.clientY,
      bounds,
      screenToFlowPosition,
    });
    if (position === null) {
      setError("Drop the node inside the canvas.");
      return;
    }
    setError("");
    addNodeAt(type, position);
  }

  function connect(connection: Connection) {
    const result = addConnection(nodes, edges, connection);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setError("");
    setValidationTouched(true);
    commit(nodes, result.edges);
    setNotice("Transition added.");
  }

  function addTransitionFromComposer(source: string, target: string) {
    connect({ source, target, sourceHandle: null, targetHandle: null });
  }

  function selectEdge(edgeId: string | null) {
    setNodes((current) =>
      current.some((node) => node.selected)
        ? current.map((node) => ({ ...node, selected: false }))
        : current,
    );
    setEdges((current) =>
      current.map((edge) =>
        edge.selected === (edge.id === edgeId) ? edge : { ...edge, selected: edge.id === edgeId },
      ),
    );
    setSelectedEdgeId(edgeId);
    setSelectedNodeIds([]);
  }

  function closeEdgeInspector() {
    selectEdge(null);
  }

  function updateSelectedConfig(config: Record<string, unknown>) {
    setNodes((current) =>
      current.map((node) =>
        selectedNodeIds.includes(node.id) ? { ...node, data: { ...node.data, config } } : node,
      ),
    );
  }

  function updateSelectedName(nextName: string) {
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeIds[0] ? { ...node, data: { ...node.data, name: nextName } } : node,
      ),
    );
  }

  function updateSelectedCondition(condition: string) {
    if (selectedEdgeId === null) {
      return;
    }
    setEdges((current) =>
      current.map((edge) =>
        edge.id === selectedEdgeId ? { ...edge, data: { ...edge.data, condition } } : edge,
      ),
    );
  }

  function deleteSelection() {
    if (selectedNodeIds.length > 0) {
      const next = selectedNodeIds.reduce(
        (snapshot, nodeId) => removeNode(snapshot.nodes, snapshot.edges, nodeId),
        { nodes, edges },
      );
      commit(next.nodes, next.edges);
      setNotice("Node deleted.");
      return;
    }
    if (selectedEdgeId !== null) {
      commit(
        nodes,
        edges.filter((edge) => edge.id !== selectedEdgeId),
      );
      setNotice("Transition deleted.");
    }
  }

  function duplicateSelection() {
    if (selectedNodeIds.length > 0) {
      const copied = copySelection(nodes, edges, selectedNodeIds);
      const copies = copied.nodes.map((node) => ({ ...node, selected: true }));
      commit(
        [...nodes.map((node) => ({ ...node, selected: false })), ...copies],
        [...edges, ...copied.edges],
      );
      setSelectedNodeIds(copies.map((node) => node.id));
      setSelectedEdgeId(null);
      setNotice("Node duplicated.");
      return;
    }
    if (selectedEdge !== null) {
      const copied = copySelection(nodes, edges, [], [selectedEdge.id]);
      const clone = copied.edges[0];
      if (clone) {
        commit(nodes, [
          ...edges.map((edge) => ({ ...edge, selected: false })),
          { ...clone, selected: true },
        ]);
        setSelectedEdgeId(clone.id);
        setSelectedNodeIds([]);
        setNotice("Edge duplicated with its condition.");
      }
    }
  }

  function copyCurrent() {
    if (selectedNodeIds.length === 0 && selectedEdgeId === null) {
      return;
    }
    const copied = copySelection(
      nodes,
      edges,
      selectedNodeIds,
      selectedEdgeId === null ? [] : [selectedEdgeId],
    );
    setClipboard(copied);
    setNotice(`${copied.nodes.length} node(s) and ${copied.edges.length} transition(s) copied.`);
  }

  function pasteCurrent() {
    if (!clipboard) {
      return;
    }
    const pasted = pasteClipboard(clipboard, nodes);
    const copies = pasted.nodes.map((node) => ({ ...node, selected: true }));
    commit(
      [...nodes.map((node) => ({ ...node, selected: false })), ...copies],
      [...edges, ...pasted.edges],
    );
    setSelectedNodeIds(copies.map((node) => node.id));
    setSelectedEdgeId(null);
    setNotice("Pasted from the canvas clipboard.");
  }

  function alignSelection(mode: AlignmentMode) {
    if (selectedNodeIds.length < 2) {
      return;
    }
    commit(alignNodes(nodes, selectedNodeIds, mode), edges);
    setNotice(`Aligned ${selectedNodeIds.length} nodes.`);
  }

  function applyUndo() {
    const result = undo(historyRef.current);
    historyRef.current = result.history;
    applySnapshot(result.snapshot);
    refreshHistoryFlags();
    setNotice("Undo.");
  }

  function applyRedo() {
    const result = redo(historyRef.current);
    historyRef.current = result.history;
    applySnapshot(result.snapshot);
    refreshHistoryFlags();
    setNotice("Redo.");
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = shortcutAction(event, {
      node: selectedNodeIds.length > 0,
      edge: selectedEdgeId !== null,
      clipboard: clipboard !== null,
    });
    if (action === null) {
      return;
    }
    event.preventDefault();
    if (action === "undo") {
      applyUndo();
    } else if (action === "redo") {
      applyRedo();
    } else if (action === "duplicate") {
      duplicateSelection();
    } else if (action === "copy") {
      copyCurrent();
    } else if (action === "paste") {
      pasteCurrent();
    } else {
      deleteSelection();
    }
  }

  function focusNode(nodeId: string) {
    setSelectedNodeIds([nodeId]);
    setSelectedEdgeId(null);
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    void fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.6 });
  }

  function focusIssue(issue: GraphIssue) {
    if (issue.nodeId) {
      focusNode(issue.nodeId);
      setNotice(issue.message);
      return;
    }
    if (issue.edgeId) {
      const edge = edges.find((candidate) => candidate.id === issue.edgeId);
      if (edge) {
        setSelectedEdgeId(edge.id);
        setSelectedNodeIds([]);
        focusNode(edge.source);
        setSelectedEdgeId(edge.id);
      }
      setNotice(issue.message);
      return;
    }
    setNotice(issue.message);
  }

  async function save(forceNew = false): Promise<string | null> {
    setError("");
    setNotice("");
    setValidationTouched(true);
    if (name.trim() === "") {
      setError("Workflow name is required.");
      return null;
    }
    if (invalidEdges.length > 0) {
      setError(
        `Fix ${invalidEdges.length} invalid condition${invalidEdges.length === 1 ? "" : "s"} before saving.`,
      );
      return null;
    }
    if (report.blocking) {
      setError(
        report.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.message)
          .join(" "),
      );
      return null;
    }
    const conditions = [...new Set(edges.map(conditionOf).filter((value) => value.trim() !== ""))];
    setSaving(true);
    try {
      let results;
      try {
        results = await Promise.all(
          conditions.map((condition) => validateExpressionApi.mutateAsync(condition)),
        );
      } catch {
        setError("Condition validation failed. Check your connection and retry.");
        return null;
      }
      const invalid = results.find((result) => !result.valid);
      if (invalid) {
        setError(invalid.errors[0]?.message ?? "A condition is invalid.");
        return null;
      }
      const definitionJson = toDefinitionJson(nodes, edges);
      const revision = definitionRevision ?? definitionQuery.data?.updatedAt ?? null;
      if (definitionId && !forceNew && revision === null) {
        setError("This draft has not loaded yet. Reload the page and try again.");
        return null;
      }
      try {
        const saved =
          definitionId && !forceNew && revision !== null
            ? await updateWorkflow.mutateAsync({
                id: definitionId,
                payload: { name, definitionJson, expectedUpdatedAt: revision },
              })
            : await createWorkflow.mutateAsync({ name, definitionJson });
        setCreatedDefinitionId(saved.id);
        setDefinitionRevision(saved.updatedAt ?? null);
        setSavedSignature(signature);
        setPublishedVersion(null);
        if (tenant) {
          clearDraft(window.localStorage, draftKey(tenant));
        }
        setAutosavedAt(null);
        setConflict(null);
        setNotice(definitionId && !forceNew ? "Draft updated" : "Draft saved");
        return saved.id;
      } catch (cause) {
        if (errorStatus(cause) === 409) {
          setConflict({
            currentUpdatedAt: definitionQuery.data?.updatedAt ?? revision ?? "unknown",
          });
          setError(
            "Another save changed this draft. Reload the server draft or keep your version as a new definition.",
          );
        } else {
          setError("Save failed. Your draft is still autosaved in this browser.");
        }
        return null;
      }
    } finally {
      setSaving(false);
    }
  }

  async function reloadServerDraft() {
    const [definitionResult, versionsResult] = await Promise.all([
      definitionQuery.refetch(),
      versionsQuery.refetch(),
    ]);
    const snapshot =
      (versionsResult.data ?? []).find((version) => version.current) ?? versionsResult.data?.[0];
    if (snapshot) {
      try {
        const parsed = parseDefinitionJson(snapshot.definitionJson);
        const loadedName = definitionResult.data?.name ?? name;
        setNodes(parsed.nodes);
        setEdges(parsed.edges);
        setName(loadedName);
        setSavedSignature(signatureOf(loadedName, parsed.nodes, parsed.edges));
      } catch {
        setError("The server draft could not be loaded.");
        return;
      }
    }
    setDefinitionRevision(definitionResult.data?.updatedAt ?? null);
    setConflict(null);
    setError("");
    setNotice("Reloaded the server draft.");
  }

  async function publish() {
    setError("");
    setNotice("");
    setPublishing(true);
    try {
      const id = definitionId ?? (await save());
      if (!id) {
        return;
      }
      const result = await publishWorkflow.mutateAsync(id);
      setCreatedDefinitionId(result.id);
      setPublishedVersion(result.currentVersion);
      setNotice(`Published version ${result.currentVersion}.`);
    } catch (cause) {
      if (errorStatus(cause) === 409) {
        setError(
          "Another tab published this workflow first. Reload the versions panel; your draft is still autosaved.",
        );
      } else {
        setError("Publish failed. Your draft has not been lost.");
      }
    } finally {
      setPublishing(false);
    }
  }

  async function rollbackTo(version: number) {
    if (!definitionId) {
      return;
    }
    const target = versions.find((snapshot) => snapshot.version === version);
    try {
      await rollbackWorkflow.mutateAsync({ id: definitionId, version });
      if (target) {
        const parsed = parseDefinitionJson(target.definitionJson);
        setNodes(parsed.nodes);
        setEdges(parsed.edges);
        setSavedSignature(signatureOf(name, parsed.nodes, parsed.edges));
        setSelectedNodeIds([]);
        setSelectedEdgeId(null);
      }
      setNotice(`Rolled back to version ${version}.`);
    } catch {
      setError("Rollback failed. The current version is unchanged.");
    }
  }

  async function archive(version: number) {
    if (!definitionId) {
      return;
    }
    try {
      await archiveVersion.mutateAsync({ id: definitionId, version });
      setNotice(`Archived version ${version}.`);
    } catch {
      setError("Archive failed. The version was not archived.");
    }
  }

  function importDefinition(json: string) {
    try {
      const parsed = parseDefinitionJson(json);
      commit(parsed.nodes, parsed.edges);
      setValidationTouched(true);
      setNotice(
        `BPMN imported: ${parsed.nodes.length} node(s), ${parsed.edges.length} transition(s).`,
      );
    } catch {
      setError("The imported BPMN produced an invalid definition.");
    }
  }

  return (
    <div className="awap-designer" onKeyDown={onKeyDown}>
      <h1>Workflow Designer</h1>

      <div className="awap-designer__toolbar">
        <input
          placeholder="Workflow name"
          aria-label="Workflow name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={invalidEdges.length > 0 || saving}
        >
          Save draft
        </button>
        <button
          type="button"
          onClick={() => void save(true)}
          disabled={invalidEdges.length > 0 || saving}
        >
          Save as new
        </button>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={publishing || report.blocking || invalidEdges.length > 0}
          aria-describedby="publish-help"
        >
          Publish
        </button>
        <span id="publish-help" className="awap-designer__hint">
          {definitionId
            ? `Definition ${definitionId.slice(0, 8)} · ${dirty ? "unsaved changes" : "saved"}`
            : "Publishing saves the current draft first."}
        </span>
        <button
          type="button"
          onClick={applyUndo}
          disabled={!historyFlags.undo}
          aria-label="Undo"
          aria-keyshortcuts="Control+Z Meta+Z"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={applyRedo}
          disabled={!historyFlags.redo}
          aria-label="Redo"
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        >
          Redo
        </button>
        <button
          type="button"
          onClick={copyCurrent}
          disabled={selectedNodeIds.length === 0 && selectedEdgeId === null}
        >
          Copy
        </button>
        <button type="button" onClick={pasteCurrent} disabled={clipboard === null}>
          Paste
        </button>
        <button
          type="button"
          onClick={duplicateSelection}
          disabled={selectedNodeIds.length === 0 && selectedEdgeId === null}
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={deleteSelection}
          disabled={selectedNodeIds.length === 0 && selectedEdgeId === null}
        >
          Delete
        </button>
      </div>

      {conflict ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="designer-conflict-title"
          className="awap-alert awap-alert-warning"
          data-testid="designer-conflict"
        >
          <h2 id="designer-conflict-title">Draft changed on the server</h2>
          <p>
            Another tab saved this draft first (server token {conflict.currentUpdatedAt}). Reload
            the server draft, or keep your version as a new definition.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void reloadServerDraft()}>
              Reload server draft
            </button>
            <button
              type="button"
              onClick={() => {
                setConflict(null);
                void save(true);
              }}
            >
              Keep mine and save as new
            </button>
            <button type="button" onClick={() => setConflict(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {selectedNodeIds.length > 1 ? (
        <div className="awap-designer__row" role="group" aria-label="Align selected nodes">
          <span className="awap-designer__hint">{selectedNodeIds.length} nodes selected</span>
          {(
            [
              ["left", "Align left"],
              ["center", "Align centre"],
              ["right", "Align right"],
              ["top", "Align top"],
              ["middle", "Align middle"],
              ["bottom", "Align bottom"],
            ] as const
          ).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => alignSelection(mode)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* A reserved-height live region keeps the canvas from shifting when a notice appears. */}
      <div className="awap-designer__messages" aria-live="polite">
        {error ? <p role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {invalidEdges.length > 0 ? (
          <p role="status" className="awap-designer__hint">
            Fix invalid edge conditions to enable saving.
          </p>
        ) : null}
        {dirty ? <p className="awap-designer__hint">Unsaved changes</p> : null}
        {autosavedAt ? (
          <p role="status" className="awap-designer__hint">
            Draft autosaved at {new Date(autosavedAt).toLocaleTimeString()}.
          </p>
        ) : null}
      </div>

      {publishedVersion !== null ? (
        <section className="awap-designer__summary" aria-labelledby="publish-summary-heading">
          <h2 id="publish-summary-heading">Published</h2>
          <p>
            Version {publishedVersion} is published and is now the current version. New instances
            start from it.
          </p>
          {definitionId ? (
            <Link href={`/instances?workflow=${encodeURIComponent(definitionId)}`}>
              View instances for this workflow
            </Link>
          ) : null}
        </section>
      ) : null}

      <div className="awap-designer__layout">
        <NodePalette
          onAdd={addNode}
          onDragIntent={(type) => {
            dragIntentRef.current = type;
          }}
        />
        <div
          data-testid="designer-canvas"
          className="awap-designer__canvas"
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
        >
          {nodes.length === 0 ? (
            <section
              className="awap-card awap-designer__empty"
              data-testid="designer-empty-state"
              aria-labelledby="designer-empty-heading"
            >
              <h2 id="designer-empty-heading">Start with a trigger</h2>
              <p className="awap-designer__hint">
                Every workflow needs exactly one START node. Add one, then connect it to a task or
                an END node.
              </p>
              <div className="awap-designer__row">
                <Button type="button" onClick={() => addNode("START")}>
                  Add START
                </Button>
                <Button type="button" variant="outline" onClick={() => addNode("END")}>
                  Add END
                </Button>
              </div>
            </section>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            isValidConnection={(connection) =>
              connectionError(nodes, edges, {
                source: connection.source,
                target: connection.target,
                sourceHandle: connection.sourceHandle ?? null,
                targetHandle: connection.targetHandle ?? null,
              }) === null
            }
            onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
              const ids = selectedNodes.map((node) => node.id);
              const edgeId = selectedEdges[0]?.id ?? null;
              // React Flow emits a fresh array on every internal update; returning the previous
              // state for an unchanged selection keeps the controlled re-render from looping.
              setSelectedNodeIds((current) =>
                current.length === ids.length && current.every((id, index) => id === ids[index])
                  ? current
                  : ids,
              );
              setSelectedEdgeId((current) => (current === edgeId ? current : edgeId));
            }}
            onNodeDragStop={rememberCurrentGraph}
            onNodeClick={(_, node) => {
              setSelectedNodeIds([node.id]);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeIds([]);
            }}
            onPaneClick={() => {
              setSelectedNodeIds([]);
              closeEdgeInspector();
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            multiSelectionKeyCode="Shift"
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
            <CanvasZoomControls />
          </ReactFlow>
        </div>

        <div className="awap-designer__side">
          {selectedEdge ? (
            <EdgeConditionEditor
              edge={selectedEdge}
              variables={workflowVariables}
              onChangeCondition={updateSelectedCondition}
              onClose={closeEdgeInspector}
              onDuplicate={duplicateSelection}
            />
          ) : selectedNode ? (
            <NodePropertiesPanel
              node={selectedNode}
              onChangeName={updateSelectedName}
              onChangeConfig={updateSelectedConfig}
              onDuplicate={duplicateSelection}
              onDelete={deleteSelection}
              onClose={() => setSelectedNodeIds([])}
            />
          ) : null}
          <ValidationPanel
            report={report}
            onFocusIssue={focusIssue}
            touched={validationTouched}
            empty={nodes.length === 0}
          />
          <ProcessNavigator
            nodes={nodes}
            selectedNodeIds={selectedNodeIds}
            onFocusNode={focusNode}
          />
        </div>
      </div>

      <nav aria-labelledby="designer-transitions-heading">
        <h2 id="designer-transitions-heading">Transitions</h2>
        <TransitionComposer nodes={nodes} onAdd={addTransitionFromComposer} />
        {edges.length === 0 ? (
          <p className="awap-designer__hint">
            No transitions yet. Drag from the source handle of a node to another node, or use the
            form above with the keyboard.
          </p>
        ) : (
          <ul className="awap-designer__nav-list">
            {edges.map((edge) => {
              const condition = conditionOf(edge);
              const label = `Edit condition from ${nodeLabel(edge.source)} to ${nodeLabel(edge.target)}`;
              return (
                <li key={edge.id}>
                  <button type="button" aria-label={label} onClick={() => selectEdge(edge.id)}>
                    {nodeLabel(edge.source)} → {nodeLabel(edge.target)}{" "}
                    {condition.trim() === "" ? "(unconditional)" : `(IF: ${condition})`}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="awap-designer__layout">
        <div className="awap-designer__side">
          <VersionHistoryPanel
            versions={versions}
            onRollback={(version) => void rollbackTo(version)}
            onArchive={(version) => void archive(version)}
            busy={rollbackWorkflow.isPending || archiveVersion.isPending}
          />
        </div>
        <div className="awap-designer__side">
          <BpmnPanel
            definitionJson={toDefinitionJson(nodes, edges)}
            onImported={importDefinition}
          />
        </div>
      </div>

      <DesignerLegend />
    </div>
  );
}

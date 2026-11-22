"use client";

import type { WorkflowNode } from "../../lib/workflowGraph";
import { Button } from "../ui/button";
import { Input, Select, Textarea } from "../ui/form-controls";

interface NodePropertiesPanelProps {
  node: WorkflowNode;
  onChangeName: (name: string) => void;
  onChangeConfig: (config: Record<string, unknown>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const TIMEOUT_TYPES = new Set([
  "TASK",
  "APPROVAL",
  "FORM",
  "AI",
  "AI_TASK",
  "WEBHOOK",
  "SCRIPT",
  "SUB_PROCESS",
  "DELAY",
]);

const RETRY_TYPES = new Set(["TASK", "FORM", "AI", "AI_TASK", "WEBHOOK", "SCRIPT", "SUB_PROCESS"]);

function configString(config: Record<string, unknown> | undefined, key: string): string {
  const value = config?.[key];
  return typeof value === "string" ? value : "";
}

function configNumber(config: Record<string, unknown> | undefined, key: string): number | "" {
  const value = config?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function retryValue(config: Record<string, unknown> | undefined, key: string): number | "" {
  const policy = config?.retryPolicy;
  if (typeof policy !== "object" || policy === null) {
    return "";
  }
  const value = (policy as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

/**
 * Properties panel for every node type (phase 5). Fields are chosen from the node type, but the
 * shared name, timeout and retry controls are available wherever the engine understands them.
 * Labels are React text, so a node named `<script>` is shown literally and never executed.
 */
export default function NodePropertiesPanel({
  node,
  onChangeName,
  onChangeConfig,
  onDuplicate,
  onDelete,
  onClose,
}: NodePropertiesPanelProps) {
  const type = node.data.type;
  const config = node.data.config ?? {};
  const update = (key: string, value: unknown) => {
    onChangeConfig({ ...config, [key]: value });
  };
  const updateNumber = (key: string, raw: string) => {
    if (raw === "") {
      const next = { ...config };
      delete next[key];
      onChangeConfig(next);
      return;
    }
    update(key, Number(raw));
  };
  const updateRetry = (key: string, raw: string) => {
    const existing =
      typeof config.retryPolicy === "object" && config.retryPolicy !== null
        ? (config.retryPolicy as Record<string, unknown>)
        : {};
    const next = { ...existing };
    if (raw === "") {
      delete next[key];
    } else {
      next[key] = Number(raw);
    }
    onChangeConfig({ ...config, retryPolicy: next });
  };
  const approvers = Array.isArray(config.approvers)
    ? config.approvers.filter((value): value is string => typeof value === "string")
    : [];

  return (
    <section
      className="awap-designer__panel"
      data-testid="node-properties"
      aria-labelledby="node-properties-heading"
    >
      <h2 id="node-properties-heading">{type} node</h2>
      <div className="awap-designer__row">
        <Button type="button" variant="outline" size="sm" onClick={onDuplicate}>
          Duplicate node
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
          Delete node
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close properties
        </Button>
      </div>

      <label className="awap-designer__field">
        Name
        <Input
          aria-label="Node name"
          value={node.data.name ?? ""}
          onChange={(event) => onChangeName(event.target.value)}
        />
      </label>

      {TIMEOUT_TYPES.has(type) ? (
        <label className="awap-designer__field">
          Timeout seconds
          <Input
            aria-label="Timeout seconds"
            type="number"
            min={1}
            value={configNumber(config, "timeoutSeconds")}
            onChange={(event) => updateNumber("timeoutSeconds", event.target.value)}
          />
        </label>
      ) : null}

      {RETRY_TYPES.has(type) ? (
        <>
          <label className="awap-designer__field">
            Max attempts
            <Input
              aria-label="Max attempts"
              type="number"
              min={1}
              max={20}
              value={retryValue(config, "maxAttempts")}
              onChange={(event) => updateRetry("maxAttempts", event.target.value)}
            />
          </label>
          <label className="awap-designer__field">
            Retry backoff (ms)
            <Input
              aria-label="Retry backoff milliseconds"
              type="number"
              min={1}
              value={retryBackoff(config, "delaysMs")}
              onChange={(event) => {
                const raw = event.target.value;
                const existing =
                  typeof config.retryPolicy === "object" && config.retryPolicy !== null
                    ? (config.retryPolicy as Record<string, unknown>)
                    : {};
                onChangeConfig({
                  ...config,
                  retryPolicy: raw === "" ? existing : { ...existing, delaysMs: [Number(raw)] },
                });
              }}
            />
          </label>
        </>
      ) : null}

      {type === "APPROVAL" || type === "AI" || type === "AI_TASK" ? (
        <label className="awap-designer__field">
          Assignees (one per line, e.g. role:MANAGER)
          <Textarea
            aria-label="Assignees"
            value={approvers.join("\n")}
            onChange={(event) =>
              update(
                "approvers",
                event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      ) : null}

      {type === "APPROVAL" ? (
        <label className="awap-designer__field">
          Assignee
          <Input
            aria-label="Assignee"
            value={configString(config, "assignee")}
            onChange={(event) => update("assignee", event.target.value)}
          />
        </label>
      ) : null}

      {type === "FORM" ? (
        <label className="awap-designer__field">
          Form definition ID
          <Input
            aria-label="Form definition ID"
            value={configString(config, "formId")}
            onChange={(event) => update("formId", event.target.value)}
          />
        </label>
      ) : null}

      {(type === "DECISION" || type === "CONDITION") && (
        <label className="awap-designer__field">
          Fallback guard expression
          <Textarea
            aria-label="Gateway condition"
            placeholder="#amount > 100"
            value={configString(config, "expression")}
            onChange={(event) => update("expression", event.target.value)}
          />
          <span className="awap-designer__hint">
            Branch conditions are edited on each outgoing edge. The guard is used only when no edge
            condition matches.
          </span>
        </label>
      )}

      {type === "DELAY" ? (
        <label className="awap-designer__field">
          Delay seconds
          <Input
            aria-label="Delay seconds"
            type="number"
            min={0}
            value={configNumber(config, "delaySeconds")}
            onChange={(event) => updateNumber("delaySeconds", event.target.value)}
          />
        </label>
      ) : null}

      {type === "PARALLEL_GATEWAY" ? (
        <label className="awap-designer__field">
          Join node id
          <Input
            aria-label="Join node id"
            value={configString(config, "joinNodeId")}
            onChange={(event) => update("joinNodeId", event.target.value)}
          />
        </label>
      ) : null}

      {type === "WEBHOOK" ? (
        <>
          <label className="awap-designer__field">
            Target URL
            <Input
              aria-label="Webhook URL"
              placeholder="https://hooks.example.com"
              value={configString(config, "url")}
              onChange={(event) => update("url", event.target.value)}
            />
          </label>
          <label className="awap-designer__field">
            Payload JSON
            <Textarea
              aria-label="Webhook payload"
              value={configString(config, "payload") || "{}"}
              onChange={(event) => update("payload", event.target.value)}
            />
          </label>
        </>
      ) : null}

      {type === "AI" || type === "AI_TASK" ? (
        <>
          <label className="awap-designer__field">
            Prompt
            <Textarea
              aria-label="AI prompt"
              value={configString(config, "prompt")}
              onChange={(event) => update("prompt", event.target.value)}
            />
          </label>
          <label className="awap-designer__field">
            Action
            <Select
              aria-label="AI action"
              value={configString(config, "action") || "SUMMARIZE"}
              onChange={(event) => update("action", event.target.value)}
            >
              <option value="SUMMARIZE">Summarize</option>
              <option value="EXTRACT">Extract</option>
              <option value="CLASSIFY">Classify</option>
            </Select>
          </label>
          <label className="awap-designer__field">
            Extraction schema (JSON, required for EXTRACT)
            <Textarea
              aria-label="Extraction schema"
              value={configString(config, "schema")}
              onChange={(event) => update("schema", event.target.value)}
            />
          </label>
        </>
      ) : null}

      {type === "SCRIPT" ? (
        <>
          <label className="awap-designer__field">
            Script (SpEL expression)
            <Textarea
              aria-label="Script expression"
              placeholder="#amount * 2"
              value={configString(config, "script")}
              onChange={(event) => update("script", event.target.value)}
            />
          </label>
          <p className="awap-designer__hint">
            The backend rejects unsafe SpEL patterns such as type references and process access.
          </p>
        </>
      ) : null}

      {type === "SUB_PROCESS" ? (
        <>
          <label className="awap-designer__field">
            Child workflow definition ID
            <Input
              aria-label="Child workflow definition ID"
              value={configString(config, "workflowDefinitionId")}
              onChange={(event) => update("workflowDefinitionId", event.target.value)}
            />
          </label>
          <label className="awap-designer__field">
            Version (optional)
            <Input
              aria-label="Child workflow version"
              type="number"
              min={1}
              value={configNumber(config, "version")}
              onChange={(event) => updateNumber("version", event.target.value)}
            />
          </label>
        </>
      ) : null}

      {type === "START" || type === "END" || type === "MERGE_GATEWAY" ? (
        <p className="awap-designer__hint">No configuration for this node type.</p>
      ) : null}
    </section>
  );
}

function retryBackoff(config: Record<string, unknown>, key: string): number | "" {
  const policy = config.retryPolicy;
  if (typeof policy !== "object" || policy === null) {
    return "";
  }
  const delays = (policy as Record<string, unknown>)[key];
  if (!Array.isArray(delays) || typeof delays[0] !== "number") {
    return "";
  }
  return delays[0];
}

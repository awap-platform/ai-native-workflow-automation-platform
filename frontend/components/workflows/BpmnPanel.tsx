"use client";

import { useRef, useState } from "react";

import { useExportWorkflowBpmn, useImportWorkflowBpmn } from "../../lib/hooks/resources";
import { describeBpmnError, MAX_BPMN_LENGTH } from "../../lib/workflowBpmn";

interface BpmnPanelProps {
  definitionJson: string;
  onImported: (definitionJson: string) => void;
}

/**
 * BPMN import/export (phase 5). Import converts XML to the internal JSON on the backend (XXE-safe,
 * line-referenced errors, 413 for oversized input); export downloads the BPMN serialization of the
 * current canvas, including unsaved edits.
 */
export default function BpmnPanel({ definitionJson, onImported }: BpmnPanelProps) {
  const importBpmn = useImportWorkflowBpmn();
  const exportBpmn = useExportWorkflowBpmn();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportedXml, setExportedXml] = useState("");

  async function handleFile(file: File | undefined) {
    setError("");
    setNotice("");
    if (!file) {
      return;
    }
    if (file.size > MAX_BPMN_LENGTH) {
      setError(`The BPMN file is larger than the ${MAX_BPMN_LENGTH} character limit.`);
      return;
    }
    const xml = await file.text();
    if (xml.length > MAX_BPMN_LENGTH) {
      setError(`The BPMN file is larger than the ${MAX_BPMN_LENGTH} character limit.`);
      return;
    }
    try {
      const result = await importBpmn.mutateAsync(xml);
      onImported(result.definitionJson);
      setNotice(`Imported ${file.name}.`);
      if (result.warnings.length > 0) {
        setError(`Warnings: ${result.warnings.join(" ")}`);
      }
    } catch (cause) {
      setError(describeBpmnError(cause));
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function handleExport() {
    setError("");
    setNotice("");
    try {
      const result = await exportBpmn.mutateAsync(definitionJson);
      setExportedXml(result.bpmnXml);
      const url = URL.createObjectURL(new Blob([result.bpmnXml], { type: "application/xml" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "workflow.bpmn";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking synchronously can cancel a download that has not started yet.
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setNotice("BPMN exported.");
    } catch (cause) {
      setError(describeBpmnError(cause));
    }
  }

  return (
    <section
      className="awap-designer__panel"
      data-testid="bpmn-panel"
      aria-labelledby="bpmn-panel-heading"
    >
      <h2 id="bpmn-panel-heading">BPMN import and export</h2>
      <p className="awap-designer__hint">
        Import replaces the canvas with the converted BPMN file. Export includes unsaved changes.
        Diagram layout is not part of BPMN interchange and is regenerated on import.
      </p>
      <div className="awap-designer__row">
        <label className="awap-designer__field">
          Import BPMN file
          <input
            ref={inputRef}
            type="file"
            accept=".bpmn,.xml,application/xml,text/xml"
            aria-label="Import BPMN file"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          aria-label="Export BPMN"
          disabled={exportBpmn.isPending}
          onClick={() => void handleExport()}
        >
          Export BPMN
        </button>
      </div>
      {exportedXml ? (
        <label className="awap-designer__field">
          Exported BPMN
          <textarea aria-label="Exported BPMN" readOnly rows={4} value={exportedXml} />
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

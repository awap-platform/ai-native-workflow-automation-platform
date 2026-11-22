"use client";

import type { GraphIssue, GraphIssueReport } from "../../lib/workflowDesigner";

interface ValidationPanelProps {
  report: GraphIssueReport;
  onFocusIssue: (issue: GraphIssue) => void;
  /** False until the user has added a node or attempted save/publish (issue 361). */
  touched?: boolean;
  /** True when the canvas has no nodes yet. */
  empty?: boolean;
}

/**
 * Validation results (phase 5). Errors block saving; END-missing is a warning. Before the first
 * interaction an empty canvas is informational, not a red error: validation becomes authoritative
 * once the user adds a node or attempts save/publish (issue 361).
 */
export default function ValidationPanel({
  report,
  onFocusIssue,
  touched = true,
  empty = false,
}: ValidationPanelProps) {
  const errors = report.issues.filter((issue) => issue.severity === "error");
  const warnings = report.issues.filter((issue) => issue.severity === "warning");

  if (!touched && empty) {
    return (
      <section
        className="awap-designer__panel"
        data-testid="validation-panel"
        data-state="empty"
        aria-labelledby="validation-heading"
      >
        <h2 id="validation-heading">Validation</h2>
        <p className="awap-designer__hint" role="status" data-testid="validation-empty">
          Nothing to validate yet. Add a START node to begin.
        </p>
      </section>
    );
  }

  return (
    <section
      className="awap-designer__panel"
      data-testid="validation-panel"
      aria-labelledby="validation-heading"
    >
      <h2 id="validation-heading">Validation</h2>
      <p className="awap-designer__hint" role="status">
        {errors.length} error(s), {warnings.length} warning(s).
        {report.blocking ? " Saving is blocked until the errors are fixed." : " Ready to save."}
      </p>
      {report.issues.length === 0 ? (
        <p className="awap-designer__hint" data-testid="validation-clean">
          No issues yet.
        </p>
      ) : (
        <ul className="awap-designer__issue-list">
          {report.issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                className={`awap-designer__issue awap-designer__issue--${issue.severity}`}
                onClick={() => onFocusIssue(issue)}
              >
                <strong>{issue.severity === "error" ? "Error" : "Warning"}:</strong>{" "}
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

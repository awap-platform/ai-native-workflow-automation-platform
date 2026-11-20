"use client";

import type { GraphIssue, GraphIssueReport } from "../../lib/workflowDesigner";

interface ValidationPanelProps {
  report: GraphIssueReport;
  onFocusIssue: (issue: GraphIssue) => void;
}

/**
 * Validation results (phase 5). Errors block saving; END-missing is a warning. Clicking an issue
 * selects and centres the offending node or transition.
 */
export default function ValidationPanel({ report, onFocusIssue }: ValidationPanelProps) {
  const errors = report.issues.filter((issue) => issue.severity === "error");
  const warnings = report.issues.filter((issue) => issue.severity === "warning");

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
        <p className="awap-designer__hint">No validation issues.</p>
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

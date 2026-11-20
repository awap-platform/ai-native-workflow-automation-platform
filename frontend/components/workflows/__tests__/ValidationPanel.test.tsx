import { fireEvent, render, screen } from "@testing-library/react";

import ValidationPanel from "../ValidationPanel";
import type { GraphIssueReport } from "../../../lib/workflowDesigner";

const report: GraphIssueReport = {
  blocking: true,
  issues: [
    {
      id: "start-missing",
      severity: "error",
      code: "start-missing",
      message: "A workflow needs exactly one START node.",
    },
    {
      id: "end-missing",
      severity: "warning",
      code: "end-missing",
      message: "A workflow needs at least one END node.",
    },
    {
      id: "unreachable",
      severity: "error",
      code: "unreachable",
      message: "Every node must be reachable from START.",
      nodeId: "orphan",
    },
  ],
};

describe("ValidationPanel", () => {
  it("separates errors from warnings and reports the save gate", () => {
    render(<ValidationPanel report={report} onFocusIssue={jest.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 error(s), 1 warning(s). Saving is blocked",
    );
    expect(screen.getAllByText("Error:", { exact: false })).toHaveLength(2);
    expect(screen.getByText("Warning:", { exact: false })).toBeInTheDocument();
  });

  it("focuses the offending node when an issue is clicked", () => {
    const onFocusIssue = jest.fn();
    render(<ValidationPanel report={report} onFocusIssue={onFocusIssue} />);
    fireEvent.click(screen.getByRole("button", { name: /Every node must be reachable/ }));
    expect(onFocusIssue).toHaveBeenCalledWith(report.issues[2]);
  });

  it("says the graph is ready when there are no issues", () => {
    render(<ValidationPanel report={{ blocking: false, issues: [] }} onFocusIssue={jest.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Ready to save");
    expect(screen.getByText("No validation issues.")).toBeInTheDocument();
  });
});

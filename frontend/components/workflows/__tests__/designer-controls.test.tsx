import { render, screen } from "@testing-library/react";

import type { WorkflowNode } from "../../../lib/workflowGraph";
import NodePalette from "../NodePalette";
import NodePropertiesPanel from "../NodePropertiesPanel";

/** Issue 359: every designer control must use the shared design-system primitives. */

function node(type: string, name = "Review", config: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: "n1",
    type: "default",
    position: { x: 0, y: 0 },
    data: { type, name, config },
  } as WorkflowNode;
}

function renderPanel(type: string, config: Record<string, unknown> = {}, name = "Review") {
  const props = {
    node: node(type, name, config),
    onChangeName: jest.fn(),
    onChangeConfig: jest.fn(),
    onDuplicate: jest.fn(),
    onDelete: jest.fn(),
    onClose: jest.fn(),
  };
  render(<NodePropertiesPanel {...props} />);
  return props;
}

describe("designer control migration", () => {
  it("renders the palette search with the shared Input class", () => {
    render(<NodePalette onAdd={jest.fn()} />);

    const search = screen.getByLabelText("Search node types");
    expect(search).toHaveClass("awap-input");
    expect(search).toHaveClass("awap-designer__palette-search");
    expect(search).toHaveAttribute("type", "search");
  });

  it("renders node property fields with input/textarea/select token classes", () => {
    renderPanel("APPROVAL", { approvers: ["role:MANAGER"], assignee: "role:MANAGER" });

    expect(screen.getByLabelText("Node name")).toHaveClass("awap-input");
    expect(screen.getByLabelText("Timeout seconds")).toHaveClass("awap-input");
    expect(screen.getByLabelText("Assignees")).toHaveClass("awap-textarea");
    expect(screen.getByLabelText("Assignee")).toHaveClass("awap-input");
  });

  it("renders the AI action as a token select", () => {
    renderPanel("AI_TASK", { prompt: "Summarize", action: "EXTRACT" });

    const action = screen.getByLabelText("AI action");
    expect(action.tagName).toBe("SELECT");
    expect(action).toHaveClass("awap-select");
  });

  it("renders retry fields and property action buttons through the design system", () => {
    renderPanel("TASK");

    expect(screen.getByLabelText("Max attempts")).toHaveClass("awap-input");
    expect(screen.getByLabelText("Retry backoff milliseconds")).toHaveClass("awap-input");

    for (const name of ["Duplicate node", "Delete node", "Close properties"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("data-slot", "button");
    }
  });

  it("shows a hostile node name as text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    renderPanel("TASK", {}, hostile);

    expect(screen.getByLabelText("Node name")).toHaveValue(hostile);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

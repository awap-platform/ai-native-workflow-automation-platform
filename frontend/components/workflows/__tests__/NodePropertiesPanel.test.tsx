import { fireEvent, render, screen } from "@testing-library/react";

import NodePropertiesPanel from "../NodePropertiesPanel";
import type { WorkflowNode } from "../../../lib/workflowGraph";

function node(type: string, config?: Record<string, unknown>, name = type): WorkflowNode {
  return {
    id: "n1",
    type: "workflow",
    position: { x: 0, y: 0 },
    data: { type, name, ...(config ? { config } : {}) },
  };
}

function renderPanel(
  workflowNode: WorkflowNode,
  overrides: Partial<Parameters<typeof NodePropertiesPanel>[0]> = {},
) {
  const handlers = {
    onChangeName: jest.fn(),
    onChangeConfig: jest.fn(),
    onDuplicate: jest.fn(),
    onDelete: jest.fn(),
    onClose: jest.fn(),
  };
  render(<NodePropertiesPanel node={workflowNode} {...handlers} {...overrides} />);
  return handlers;
}

describe("NodePropertiesPanel", () => {
  it("edits the shared name and reports it", () => {
    const handlers = renderPanel(node("TASK"));
    const input = screen.getByLabelText("Node name");
    expect(input).toHaveValue("TASK");
    fireEvent.change(input, { target: { value: "Review invoice" } });
    expect(handlers.onChangeName).toHaveBeenCalledWith("Review invoice");
  });

  it("shows timeout and retry policy for an executable node", () => {
    const handlers = renderPanel(
      node("TASK", { timeoutSeconds: 30, retryPolicy: { maxAttempts: 4, delaysMs: [500] } }),
    );
    expect(screen.getByLabelText("Timeout seconds")).toHaveValue(30);
    expect(screen.getByLabelText("Max attempts")).toHaveValue(4);
    expect(screen.getByLabelText("Retry backoff milliseconds")).toHaveValue(500);
    fireEvent.change(screen.getByLabelText("Max attempts"), { target: { value: "5" } });
    expect(handlers.onChangeConfig).toHaveBeenCalledWith({
      timeoutSeconds: 30,
      retryPolicy: { maxAttempts: 5, delaysMs: [500] },
    });
  });

  it("shows assignees for approvals and AI tasks", () => {
    renderPanel(node("APPROVAL", { approvers: ["role:MANAGER", "user:42"] }));
    expect(screen.getByLabelText("Assignees")).toHaveValue("role:MANAGER\nuser:42");
    expect(screen.getByLabelText("Assignee")).toBeInTheDocument();
  });

  it.each([
    ["FORM", "Form definition ID"],
    ["AI", "AI prompt"],
    ["AI_TASK", "AI prompt"],
    ["SCRIPT", "Script expression"],
    ["DECISION", "Gateway condition"],
    ["CONDITION", "Gateway condition"],
    ["WEBHOOK", "Webhook URL"],
    ["SUB_PROCESS", "Child workflow definition ID"],
    ["DELAY", "Delay seconds"],
    ["PARALLEL_GATEWAY", "Join node id"],
  ])("renders the %s inspector field", (type, label) => {
    renderPanel(node(type));
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it("renders labels as text, never as markup (XSS via node name)", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <NodePropertiesPanel
        node={node("TASK", undefined, hostile)}
        onChangeName={jest.fn()}
        onChangeConfig={jest.fn()}
        onDuplicate={jest.fn()}
        onDelete={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByLabelText("Node name")).toHaveValue(hostile);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "TASK node" })).toBeInTheDocument();
  });

  it("offers structural actions", () => {
    const handlers = renderPanel(node("END"));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate node" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete node" }));
    fireEvent.click(screen.getByRole("button", { name: "Close properties" }));
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No configuration for this node type.")).toBeInTheDocument();
  });
});

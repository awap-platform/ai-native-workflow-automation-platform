import { fireEvent, render, screen, within } from "@testing-library/react";

import type { TaskDto } from "../../../lib/api";
import { Checkbox } from "../../ui/form-controls";
import TaskList from "../TaskList";

/** Issue #357: the row selection label must stay accessible but never become visible text. */

const NOW = Date.parse("2026-11-20T12:00:00Z");

function task(overrides: Partial<TaskDto> & { id: string; title: string }): TaskDto {
  return {
    tenantId: "tenant-a",
    workflowInstanceId: "inst-1",
    description: null,
    assigneeId: "user-1",
    status: "ASSIGNED",
    version: 1,
    decisionComment: null,
    taskType: "APPROVAL",
    escalated: false,
    escalateAt: "2026-11-20T13:00:00Z",
    createdAt: "2026-11-20T09:00:00Z",
    updatedAt: "2026-11-20T09:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

const rows: TaskDto[] = [
  task({ id: "task-1", title: "Approve leave request" }),
  task({
    id: "task-2",
    title:
      "Approve the international travel and accommodation request for the Q4 finance conference with a very long descriptive title",
  }),
  task({
    id: "task-3",
    title: "Şirketler arası ödeme onayı ve belge kontrolü",
    status: "IN_PROGRESS",
    escalateAt: "2026-11-20T11:00:00Z",
  }),
];

function renderList(overrides: Partial<React.ComponentProps<typeof TaskList>> = {}) {
  return render(
    <TaskList
      rows={rows}
      now={NOW}
      selectedId={null}
      checkedIds={new Set<string>()}
      onSelect={jest.fn()}
      onToggleCheck={jest.fn()}
      onToggleAll={jest.fn()}
      {...overrides}
    />,
  );
}

describe("Checkbox hideLabel", () => {
  it("keeps the accessible name but renders no visible label node", () => {
    const { container } = render(
      <Checkbox hideLabel label="Select Approve leave request" data-testid="hidden-check" />,
    );

    const input = screen.getByTestId("hidden-check");
    expect(input).toHaveAttribute("aria-label", "Select Approve leave request");
    expect(screen.getByRole("checkbox", { name: "Select Approve leave request" })).toBe(input);
    expect(container.querySelector(".awap-checkbox-label")).toBeNull();
    expect(screen.queryByText("Select Approve leave request")).not.toBeInTheDocument();
  });

  it("still renders a visible label when hideLabel is not set", () => {
    render(<Checkbox label="Notify me" />);
    expect(screen.getByText("Notify me")).toBeVisible();
  });

  it("does not invoke onChange for a disabled checkbox", () => {
    const onChange = jest.fn();
    render(<Checkbox hideLabel label="Select work item" disabled onChange={onChange} data-testid="disabled-check" />);

    fireEvent.click(screen.getByTestId("disabled-check"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TaskList row layout contract", () => {
  it("hides row labels but keeps the select-all label visible", () => {
    const { container } = renderList();

    // Only the select-all checkbox keeps a visible label span.
    expect(container.querySelectorAll(".awap-checkbox-label")).toHaveLength(1);
    expect(screen.getByText("Select all visible work items")).toBeVisible();

    for (const row of rows) {
      const checkbox = screen.getByTestId(`task-check-${row.id}`);
      expect(checkbox).toHaveAttribute("aria-label");
      expect(checkbox.getAttribute("aria-label")).toContain(row.title);

      const listItem = screen.getByTestId(`task-row-${row.id}`).closest("li");
      expect(listItem?.querySelector(".awap-checkbox-label")).toBeNull();
    }
  });

  it("gives the title column a shrink contract and keeps the badge inside it", () => {
    renderList();

    for (const row of rows) {
      const titleButton = screen.getByTestId(`task-row-${row.id}`);
      expect(titleButton).toHaveClass("min-w-0", "flex-1");

      // The status badge and SLA chip live inside the shrunken title column, so they
      // cannot be pushed underneath the checkbox by a long title.
      const badge = within(titleButton).getByTestId(`task-status-${row.status}`);
      expect(titleButton).toContainElement(badge);
    }
  });

  it("uses singular count copy for one result", () => {
    renderList({ rows: [rows[0]!] });
    expect(screen.getByTestId("task-result-count")).toHaveTextContent("1 result");
  });

  it("toggles select-all and a single row exactly once per click", () => {
    const onToggleAll = jest.fn();
    const onToggleCheck = jest.fn();
    renderList({ onToggleAll, onToggleCheck });

    fireEvent.click(screen.getByTestId("task-select-all"));
    expect(onToggleAll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("task-check-task-1"));
    expect(onToggleCheck).toHaveBeenCalledTimes(1);
    expect(onToggleCheck).toHaveBeenCalledWith("task-1");
  });
});

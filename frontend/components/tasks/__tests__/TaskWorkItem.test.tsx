import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError, type TaskDto } from "../../../lib/api";
import { clearDraft, loadDraft } from "../../../lib/tasks/drafts";
import { ToastProvider } from "../../ui/overlays";
import TaskWorkItem from "../TaskWorkItem";

const mutateAsync = jest.fn();
const reset = jest.fn();

jest.mock("../../../lib/hooks/resources", () => ({
  useTaskAction: () => ({ mutateAsync, isPending: false, reset }),
  useTaskActivity: () => ({ data: [], isLoading: false }),
  useTaskAttachments: () => ({ data: [], isLoading: false }),
  useAddTaskComment: () => ({ mutate: jest.fn(), isPending: false }),
  useAttachTaskFile: () => ({ mutate: jest.fn(), isPending: false }),
}));

const NOW = Date.parse("2026-11-20T12:00:00Z");

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "task-1",
    tenantId: "tenant-a",
    workflowInstanceId: "inst-1",
    title: "Approve expense",
    description: "Q4 report",
    assigneeId: "user-1",
    status: "ASSIGNED",
    version: 3,
    decisionComment: null,
    taskType: "APPROVAL",
    escalated: false,
    escalateAt: "2026-11-20T13:00:00Z",
    createdAt: "2026-11-20T09:00:00Z",
    updatedAt: "2026-11-20T09:30:00Z",
    completedAt: null,
    ...overrides,
  };
}

function renderItem(overrides: Partial<TaskDto> = {}, onReload = jest.fn()) {
  return render(
    <ToastProvider>
      <TaskWorkItem task={task(overrides)} now={NOW} onReload={onReload} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  window.localStorage.clear();
  clearDraft("task-1");
});

describe("TaskWorkItem decisions", () => {
  it("requires a comment before rejecting and refuses to open the confirmation", () => {
    renderItem();
    fireEvent.click(screen.getByRole("tab", { name: "Decision" }));
    fireEvent.click(screen.getByTestId("task-reject"));

    expect(screen.getByTestId("task-error")).toHaveTextContent(
      "A comment is required to reject a work item.",
    );
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("approves once even when the confirm button is double-clicked", async () => {
    mutateAsync.mockImplementation(() => new Promise(() => undefined));
    renderItem();

    fireEvent.click(screen.getByRole("tab", { name: "Decision" }));
    fireEvent.click(screen.getByTestId("task-approve"));
    const confirm = screen.getByRole("button", { name: "Confirm" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1", action: "approve" }),
    );
  });

  it("sends the rejection comment and clears the draft on success", async () => {
    mutateAsync.mockResolvedValue(task({ status: "REJECTED" }));
    renderItem();

    fireEvent.click(screen.getByRole("tab", { name: "Decision" }));
    fireEvent.change(screen.getByTestId("task-comment"), {
      target: { value: "Missing receipt" },
    });
    expect(loadDraft("task-1")).toBe("Missing receipt");

    fireEvent.click(screen.getByTestId("task-reject"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: "task-1",
        action: "reject",
        comment: "Missing receipt",
      }),
    );
    await waitFor(() => expect(loadDraft("task-1")).toBe(""));
  });

  it("translates a 409 into a human conflict message and offers a reload", async () => {
    const onReload = jest.fn();
    mutateAsync.mockRejectedValue(new ApiError(409, "conflict", "corr-9"));
    renderItem({ status: "IN_PROGRESS" }, onReload);

    fireEvent.click(screen.getByRole("tab", { name: "Decision" }));
    fireEvent.click(screen.getByTestId("task-approve"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const alert = await screen.findByTestId("task-error");
    expect(alert).toHaveTextContent(
      "This work item changed while you were reading it. Reload and try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload the work item" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("shows the recorded timeline and the contract variables", () => {
    renderItem({ status: "REJECTED", completedAt: "2026-11-20T10:00:00Z", decisionComment: "No" });

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const history = within(screen.getByLabelText("Recorded history"));
    expect(history.getByText("Rejected")).toBeInTheDocument();
    expect(history.getByText("No")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Variables" }));
    expect(screen.getByTestId("task-variables")).toHaveTextContent("Workflow instance");
    expect(screen.getByTestId("task-variables")).toHaveTextContent("inst-1");
  });
});

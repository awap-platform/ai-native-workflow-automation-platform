import { fireEvent, render, screen } from "@testing-library/react";

import type { CopilotResponseDto } from "../../../../lib/api";
import CopilotPage from "../page";

const mutate = jest.fn();
let hookState: {
  mutate: jest.Mock;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
  data: CopilotResponseDto | undefined;
} = {
  mutate,
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: undefined,
};

jest.mock("../../../../lib/hooks/useCopilot", () => ({
  useCopilotChat: () => hookState,
}));

const response: CopilotResponseDto = {
  answer: "I found a matching workflow. Confirm that you want me to start it.",
  action: "start_workflow",
  confidence: 0.82,
  requires_human_approval: true,
  tool_calls: [{ name: "find_workflow", arguments: {}, result: [], ok: true, error: null }],
  data: { workflowId: "wf-1" },
  model: "gpt-4o-mini",
  model_tier: "standard",
  prompt_version: "v1",
  correlation_id: "corr-1",
  idempotency_key: null,
};

function submit(message: string, confirmed = false): void {
  fireEvent.change(screen.getByLabelText("Your request"), { target: { value: message } });
  if (confirmed) {
    fireEvent.click(
      screen.getByLabelText(
        "I confirm this high-risk action (start workflow, task decision or approval).",
      ),
    );
  }
  fireEvent.click(screen.getByRole("button", { name: "Send to Copilot" }));
}

describe("CopilotPage", () => {
  beforeEach(() => {
    mutate.mockReset();
    hookState = {
      mutate,
      isPending: false,
      isError: false,
      isSuccess: false,
      error: null,
      data: undefined,
    };
  });

  it("sends the natural-language request without high-risk confirmation by default", () => {
    render(<CopilotPage />);

    expect(screen.getByRole("heading", { name: "AI Copilot" })).toBeInTheDocument();
    submit("İzin talebi başlat");

    expect(mutate).toHaveBeenCalledWith({
      message: "İzin talebi başlat",
      confirm_high_risk: false,
      idempotency_key: expect.any(String),
    });
  });

  it("reuses the key for a retry of the same intent", () => {
    render(<CopilotPage />);

    submit("start leave request");
    submit("start leave request");

    const first = mutate.mock.calls[0][0].idempotency_key;
    const retry = mutate.mock.calls[1][0].idempotency_key;
    expect(first).toBeTruthy();
    expect(retry).toBe(first);
  });

  it("rotates the key when the intent text changes", () => {
    render(<CopilotPage />);

    submit("start leave request");
    submit("start expense request");

    const first = mutate.mock.calls[0][0].idempotency_key;
    const next = mutate.mock.calls[1][0].idempotency_key;
    expect(next).not.toBe(first);
  });

  it("renders the HITL warning, model metadata and tool calls", () => {
    hookState = { ...hookState, data: response };
    render(<CopilotPage />);

    expect(screen.getByTestId("copilot-answer")).toHaveTextContent("Confirm");
    expect(screen.getByTestId("copilot-hitl")).toHaveTextContent("Human confirmation");
    expect(screen.getByTestId("copilot-tool-calls")).toHaveTextContent("find_workflow");
    expect(screen.getByText("gpt-4o-mini (standard)")).toBeInTheDocument();
  });

  it("marks the request as confirmed when the high-risk checkbox is selected", () => {
    render(<CopilotPage />);

    submit("Approve task", true);

    expect(mutate).toHaveBeenCalledWith({
      message: "Approve task",
      confirm_high_risk: true,
      idempotency_key: expect.any(String),
    });
  });
});

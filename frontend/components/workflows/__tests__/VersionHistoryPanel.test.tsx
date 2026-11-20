import { fireEvent, render, screen } from "@testing-library/react";

import VersionHistoryPanel from "../VersionHistoryPanel";
import type { WorkflowVersionSnapshot } from "../../../lib/workflowVersions";

const definition = (name: string): string =>
  JSON.stringify({ nodes: [{ id: "s", type: "START", name }], transitions: [] });

const versions: WorkflowVersionSnapshot[] = [
  {
    version: 2,
    definitionJson: definition("Second"),
    status: "PUBLISHED",
    archived: false,
    current: true,
    createdAt: "2026-01-02T00:00:00Z",
  },
  {
    version: 1,
    definitionJson: definition("First"),
    status: "PUBLISHED",
    archived: false,
    current: false,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

describe("VersionHistoryPanel", () => {
  it("compares two versions and shows the summary", () => {
    render(
      <VersionHistoryPanel versions={versions} onRollback={jest.fn()} onArchive={jest.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Versions" })).toBeInTheDocument();
    expect(screen.getByTestId("version-diff")).toBeInTheDocument();
    expect(screen.getByText("1 node(s) changed")).toBeInTheDocument();
  });

  it("offers rollback only for a published non-current version", () => {
    const onRollback = jest.fn();
    render(
      <VersionHistoryPanel versions={versions} onRollback={onRollback} onArchive={jest.fn()} />,
    );
    const rollback = screen.getByRole("button", { name: "Rollback to version 1" });
    expect(rollback).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rollback to version 2" })).toBeDisabled();
    fireEvent.click(rollback);
    expect(onRollback).toHaveBeenCalledWith(1);
  });

  it("archives a non-current version", () => {
    const onArchive = jest.fn();
    render(
      <VersionHistoryPanel versions={versions} onRollback={jest.fn()} onArchive={onArchive} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive version 1" }));
    expect(onArchive).toHaveBeenCalledWith(1);
  });

  it("explains that history appears after the first save", () => {
    render(<VersionHistoryPanel versions={[]} onRollback={jest.fn()} onArchive={jest.fn()} />);
    expect(screen.getByText(/Save the draft to create the first version/)).toBeInTheDocument();
  });
});

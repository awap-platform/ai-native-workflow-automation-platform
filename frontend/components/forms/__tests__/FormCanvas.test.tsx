import { fireEvent, render, screen } from "@testing-library/react";

import FormCanvas, { ROW_DRAG_MIME } from "../FormCanvas";
import FormFieldPalette, { FIELD_DRAG_MIME, PALETTE_TYPES } from "../FormFieldPalette";
import { FIELD_TYPES, type FormSchema } from "../../../lib/forms/schema";

const schema: FormSchema = {
  fields: [
    { id: "name", type: "TEXT", label: "Name" },
    { id: "intro", type: "SECTION", label: "Details" },
    {
      id: "email",
      type: "EMAIL",
      label: "Email",
      visibleWhen: { fieldId: "name", operator: "IS_NOT_EMPTY" },
    },
  ],
};

function dataTransfer(values: Record<string, string>) {
  const types = Object.keys(values);
  return {
    types,
    dropEffect: "none",
    effectAllowed: "none",
    setData: jest.fn(),
    getData: (type: string) => values[type] ?? "",
  };
}

describe("form field palette", () => {
  it("offers every field type exactly once", () => {
    render(<FormFieldPalette onAdd={jest.fn()} />);
    expect(PALETTE_TYPES.slice().sort()).toEqual([...FIELD_TYPES].sort());
    expect(screen.getAllByRole("button")).toHaveLength(FIELD_TYPES.length);
  });

  it("inserts a field by click and filters by search", () => {
    const onAdd = jest.fn();
    render(<FormFieldPalette onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "TEXT" }));
    expect(onAdd).toHaveBeenCalledWith("TEXT");

    fireEvent.change(screen.getByLabelText("Search field types"), {
      target: { value: "phone" },
    });
    expect(screen.getByRole("button", { name: "PHONE" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "TEXT" })).not.toBeInTheDocument();
  });
});

describe("form canvas", () => {
  function renderCanvas(overrides: Partial<Parameters<typeof FormCanvas>[0]> = {}) {
    const handlers = {
      onSelect: jest.fn(),
      onMove: jest.fn(),
      onRemove: jest.fn(),
      onAdd: jest.fn(),
      onReorder: jest.fn(),
      ...overrides,
    };
    render(
      <FormCanvas
        schema={schema}
        selectedId="name"
        issues={[{ fieldId: "email", message: '"Email" is broken.' }]}
        {...handlers}
      />,
    );
    return handlers;
  }

  it("selects, reorders with the keyboard and removes rows", () => {
    const handlers = renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "Select Email" }));
    expect(handlers.onSelect).toHaveBeenCalledWith("email");

    fireEvent.click(screen.getByRole("button", { name: "Move Name down" }));
    expect(handlers.onMove).toHaveBeenCalledWith("name", 1);

    fireEvent.click(screen.getByRole("button", { name: "Remove Name" }));
    expect(handlers.onRemove).toHaveBeenCalledWith("name");
  });

  it("disables the impossible move direction", () => {
    renderCanvas();
    expect(screen.getByRole("button", { name: "Move Name up" })).toBeDisabled();
  });

  it("accepts a palette drop at a position and a row drop for reordering", () => {
    const handlers = renderCanvas();
    const dropzones = screen.getAllByText("Drop here");
    const first = dropzones[0];
    if (!first) {
      throw new Error("missing dropzone");
    }

    fireEvent.dragOver(first, { dataTransfer: dataTransfer({ [FIELD_DRAG_MIME]: "TEXT" }) });
    fireEvent.drop(first, { dataTransfer: dataTransfer({ [FIELD_DRAG_MIME]: "TEXT" }) });
    expect(handlers.onAdd).toHaveBeenCalledWith("TEXT", 0);

    fireEvent.drop(first, { dataTransfer: dataTransfer({ [ROW_DRAG_MIME]: "2" }) });
    expect(handlers.onReorder).toHaveBeenCalledWith(2, 0);
  });

  it("shows the condition and schema problem for a row", () => {
    renderCanvas();
    expect(screen.getByText("Show when name is not empty")).toBeInTheDocument();
    expect(screen.getByText('"Email" is broken.')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Name" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

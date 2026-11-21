import { fireEvent, render, screen } from "@testing-library/react";

import FormRenderer, { renderedFieldIds } from "../FormRenderer";
import type { FormSchema, FormValues } from "../../../lib/forms/schema";

const schema: FormSchema = {
  fields: [
    { id: "intro", type: "SECTION", label: "Customer" },
    { id: "name", type: "TEXT", label: "Name", required: true },
    { id: "notes", type: "TEXTAREA", label: "Notes", help: "Optional context" },
    { id: "amount", type: "NUMBER", label: "Amount", min: 1, max: 10 },
    { id: "email", type: "EMAIL", label: "Email" },
    { id: "phone", type: "PHONE", label: "Phone" },
    { id: "date", type: "DATE", label: "Date" },
    { id: "at", type: "DATETIME", label: "When" },
    { id: "agree", type: "BOOLEAN", label: "I agree" },
    { id: "tier", type: "SELECT", label: "Tier", options: ["Gold", "Silver"] },
    { id: "tags", type: "MULTI_SELECT", label: "Tags", options: ["a", "b"] },
    { id: "split", type: "DIVIDER" },
    { id: "alt", type: "TEXT", label: "Alternative" },
    {
      id: "detail",
      type: "TEXT",
      label: "Detail",
      visibleWhen: { fieldId: "tier", operator: "EQUALS", value: "Gold" },
    },
    { id: "units", type: "NUMBER", label: "Units" },
    { id: "total", type: "NUMBER", label: "Total", calculated: "units * 2" },
  ],
};

const values: FormValues = { name: "Ada", tier: "Gold", units: "3" };

describe("T6-07 preview and fill render the same fields", () => {
  it("produces identical markup for two renders with the same schema and values", () => {
    const first = render(<FormRenderer schema={schema} values={values} idPrefix="x" />);
    const firstMarkup = first.container.innerHTML;
    first.unmount();

    const second = render(<FormRenderer schema={schema} values={values} idPrefix="x" />);
    expect(second.container.innerHTML).toBe(firstMarkup);

    expect(renderedFieldIds(schema, values)).toEqual([
      "name",
      "notes",
      "amount",
      "email",
      "phone",
      "date",
      "at",
      "agree",
      "tier",
      "tags",
      "alt",
      "detail",
      "units",
      "total",
    ]);
  });

  it("hides a conditional field from both surfaces and computes the calculated one", () => {
    const { container } = render(
      <FormRenderer schema={schema} values={{ ...values, tier: "Silver" }} idPrefix="y" />,
    );
    expect(container.querySelector('[data-field-id="detail"]')).toBeNull();
    const total = container.querySelector<HTMLInputElement>("#y-total");
    expect(total?.value).toBe("6");
    expect(total?.readOnly).toBe(true);
  });
});

describe("T6-08 error summary and focus management", () => {
  it("focuses the summary after a submit attempt and links to the field", () => {
    const errors = [{ fieldId: "name", message: '"Name" is required.' }];
    const { rerender } = render(
      <FormRenderer
        schema={schema}
        values={{}}
        errors={errors}
        idPrefix="fill"
        focusRequests={0}
      />,
    );

    rerender(
      <FormRenderer
        schema={schema}
        values={{}}
        errors={errors}
        idPrefix="fill"
        focusRequests={1}
      />,
    );

    const summary = screen.getByTestId("form-error-summary");
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute("role", "alert");

    fireEvent.click(screen.getByRole("button", { name: '"Name" is required.' }));
    expect(document.getElementById("fill-name")).toHaveFocus();
    expect(screen.getByLabelText("Name (required)")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not render a summary when there are no errors", () => {
    render(<FormRenderer schema={schema} values={values} idPrefix="fill" />);
    expect(screen.queryByTestId("form-error-summary")).not.toBeInTheDocument();
  });
});

describe("security and read-only rendering", () => {
  it("renders a hostile label as inert text", () => {
    const hostile: FormSchema = {
      fields: [
        {
          id: "hostile",
          type: "TEXT",
          label: '<img src="x" onerror="alert(1)">',
          help: "<script>alert(2)</script>",
        },
      ],
    };
    const { container } = render(<FormRenderer schema={hostile} values={{}} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText('<img src="x" onerror="alert(1)">')).toBeInTheDocument();
  });

  it("renders every field type with a labelled control", () => {
    const { container } = render(<FormRenderer schema={schema} values={values} idPrefix="t" />);
    for (const id of [
      "name",
      "notes",
      "amount",
      "email",
      "phone",
      "date",
      "at",
      "agree",
      "tier",
      "tags",
      "units",
    ]) {
      expect(container.querySelector(`[data-field-id="${id}"]`)).not.toBeNull();
    }
    expect(container.querySelectorAll("fieldset")).toHaveLength(1);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
  });

  it("does not call onChange in read-only mode", () => {
    const onChange = jest.fn();
    const { container } = render(
      <FormRenderer
        schema={schema}
        values={values}
        idPrefix="r"
        readOnly
        onChange={onChange}
      />,
    );
    const input = container.querySelector<HTMLInputElement>("#r-name");
    expect(input?.readOnly).toBe(true);
    if (input) {
      fireEvent.change(input, { target: { value: "changed" } });
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

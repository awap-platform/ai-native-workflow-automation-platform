import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Button } from "../button";
import {
  Breadcrumb,
  DataGrid,
  Pagination,
  Stepper,
  Table,
  Tabs,
  Timeline,
} from "../data-display";
import {
  Checkbox,
  Combobox,
  DatePicker,
  FileDropzone,
  FormField,
  Input,
  RadioGroup,
  Select,
  Switch,
  Textarea,
} from "../form-controls";
import { IconButton } from "../icon-button";
import {
  CommandPalette,
  ConfirmDialog,
  Dialog,
  Drawer,
  Menu,
  Popover,
  ToastProvider,
  Tooltip,
  useToast,
} from "../overlays";
import { Avatar, Badge, Card, CardHeader, CardTitle, SkeletonGroup, StatCard } from "../surface";

describe("Button", () => {
  it("renders variants and refuses clicks when disabled or loading", () => {
    const onClick = jest.fn();
    render(
      <div>
        <Button onClick={onClick}>Save</Button>
        <Button variant="outline">Cancel</Button>
        <Button variant="destructive">Delete</Button>
        <Button disabled onClick={onClick}>
          Disabled
        </Button>
        <Button loading onClick={onClick}>
          Loading
        </Button>
        <IconButton label="Add">+</IconButton>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Loading" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Loading" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Add" })).toHaveAttribute("aria-label", "Add");
    expect(screen.getByRole("button", { name: "Save" }).parentElement).toMatchSnapshot();
  });
});

describe("Form controls", () => {
  it("renders labelled fields, hints and errors", () => {
    render(
      <div>
        <FormField id="name" label="Full name" hint="As on the request.">
          <Input id="name" defaultValue="Ada" aria-describedby="name-hint" />
        </FormField>
        <FormField id="email" label="Email" error="Required">
          <Input id="email" aria-invalid="true" />
        </FormField>
        <FormField id="notes" label="Notes">
          <Textarea id="notes" defaultValue="Some notes" />
        </FormField>
        <FormField id="select" label="Decision">
          <Select id="select" defaultValue="approve">
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
          </Select>
        </FormField>
        <DatePicker label="Due date" id="due" defaultValue="2026-11-19" />
        <Checkbox label="Notify" defaultChecked />
      </div>,
    );

    expect(screen.getByLabelText("Full name")).toHaveValue("Ada");
    expect(screen.getByText("As on the request.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(screen.getByLabelText("Notes")).toHaveValue("Some notes");
    expect(screen.getByLabelText("Decision")).toHaveValue("approve");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-11-19");
    expect(screen.getByLabelText("Notify")).toBeChecked();
    expect(screen.getByText("Full name").closest("div")).toMatchSnapshot();
  });

  it("supports radio groups, switches and file selection", () => {
    function Harness() {
      const [radio, setRadio] = useState("manager");
      const [on, setOn] = useState(true);
      return (
        <div>
          <RadioGroup
            legend="Approver"
            name="approver"
            value={radio}
            onValueChange={setRadio}
            options={[
              { value: "manager", label: "Manager" },
              { value: "finance", label: "Finance" },
            ]}
          />
          <Switch label="Auto approve" checked={on} onCheckedChange={setOn} />
          <FileDropzone label="Attachment" accept=".pdf" />
        </div>
      );
    }
    const { container } = render(<Harness />);

    fireEvent.click(screen.getByLabelText("Finance"));
    expect(screen.getByLabelText("Finance")).toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Auto approve" }));
    expect(screen.getByRole("switch", { name: "Auto approve" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["pdf"], "contract.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("contract.pdf")).toBeInTheDocument();
  });

  it("filters and selects combobox options with the keyboard", () => {
    const onValueChange = jest.fn();
    render(
      <Combobox
        label="Task kind"
        value=""
        onValueChange={onValueChange}
        options={[
          { value: "approval", label: "Approval" },
          { value: "review", label: "Review" },
        ]}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Task kind" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rev" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("review");
  });
});

describe("Surfaces", () => {
  it("renders badges, cards, stats, avatars and skeletons", () => {
    const { container } = render(
      <div>
        <Badge>Default</Badge>
        <Badge variant="success">Success</Badge>
        <Card>
          <CardHeader>
            <CardTitle>Expense approval</CardTitle>
          </CardHeader>
        </Card>
        <StatCard label="Pending" value={12} detail="+3" tone="warning" />
        <Avatar name="Ada Lovelace" />
        <SkeletonGroup lines={2} label="Loading" />
      </div>,
    );
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Expense approval")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(container).toMatchSnapshot();
  });
});

describe("Data display", () => {
  it("renders tables, tabs, pagination, steppers, timelines and breadcrumbs", () => {
    function Harness() {
      const [tab, setTab] = useState("overview");
      const [page, setPage] = useState(1);
      return (
        <div>
          <Table>
            <caption>Rows</caption>
            <tbody>
              <tr>
                <td>One</td>
              </tr>
            </tbody>
          </Table>
          <DataGrid
            rows={[{ id: "1", name: "Approve" }]}
            columns={[{ key: "name", header: "Name" }]}
            getRowKey={(row) => row.id}
          />
          <Tabs
            ariaLabel="Sections"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: "overview", label: "Overview", content: <p>Overview</p> },
              { value: "activity", label: "Activity", content: <p>Activity</p> },
            ]}
          />
          <Pagination page={page} totalPages={3} onPageChange={setPage} />
          <Stepper current={1} steps={[{ label: "Draft" }, { label: "Review" }]} />
          <Timeline items={[{ id: "1", title: "Created", time: "09:00" }]} />
          <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Current" }]} />
        </div>
      );
    }
    render(<Harness />);

    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByText("Activity", { selector: "p" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  it("moves tab selection with the arrow keys", () => {
    function Harness() {
      const [tab, setTab] = useState("a");
      return (
        <Tabs
          ariaLabel="Sections"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "a", label: "A", content: <p>A</p> },
            { value: "b", label: "B", content: <p>B</p> },
          ]}
        />
      );
    }
    render(<Harness />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Overlays and focus management", () => {
  it("opens a dialog, traps focus and closes on Escape", () => {
    const onOpenChange = jest.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Start workflow"
        description="Confirm the context."
        footer={<Button>Start</Button>}
      >
        <Input aria-label="Context" />
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Start workflow" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens a drawer and restores focus to the trigger on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open drawer
          </button>
          <Drawer open={open} onOpenChange={setOpen} title="Filters">
            <p>Drawer content</p>
          </Drawer>
        </div>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open drawer" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders tooltip, popover and menu interactions", () => {
    const onSelect = jest.fn();
    render(
      <div>
        <Tooltip label="Download report">
          <Button>Download</Button>
        </Tooltip>
        <Popover label="Filters" trigger="Filters">
          <p>Popover content</p>
        </Popover>
        <Menu
          label="Row actions"
          trigger="Actions"
          items={[{ label: "Duplicate", onSelect }]}
        />
      </div>,
    );

    const download = screen.getByRole("button", { name: "Download" });
    fireEvent.focus(download);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Download report");

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toHaveTextContent("Popover content");

    fireEvent.click(screen.getByRole("button", { name: "Row actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(onSelect).toHaveBeenCalled();
  });

  it("confirms destructive actions", () => {
    const onConfirm = jest.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Delete row?"
        description="Cannot be undone."
        onConfirm={onConfirm}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("shows a toast and dismisses it", () => {
    function Harness() {
      const { toast } = useToast();
      return (
        <Button onClick={() => toast({ title: "Saved", description: "Stored.", variant: "success" })}>
          Show toast
        </Button>
      );
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("filters the command palette and selects with Enter", () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        items={[
          { id: "one", label: "Open inbox", onSelect },
          { id: "two", label: "Open workflows", onSelect },
        ]}
        title="Commands"
        placeholder="Search"
        emptyLabel="No results"
      />,
    );
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "inbox" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});

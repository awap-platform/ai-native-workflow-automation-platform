"use client";

import { useState, type ReactNode } from "react";
import { Download, Plus, Settings, Trash2 } from "lucide-react";
import { ApiError } from "../../../lib/api";
import { useI18n } from "../../../lib/locale";
import { useTheme } from "../../../lib/theme";
import { Button } from "../../../components/ui/button";
import {
  Breadcrumb,
  DataGrid,
  Pagination,
  Stepper,
  Table,
  Tabs,
  Timeline,
} from "../../../components/ui/data-display";
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
} from "../../../components/ui/form-controls";
import { IconButton } from "../../../components/ui/icon-button";
import {
  CommandPalette,
  ConfirmDialog,
  Dialog,
  Drawer,
  Menu,
  Popover,
  Tooltip,
  useToast,
  type CommandItem,
} from "../../../components/ui/overlays";
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  OfflineState,
} from "../../../components/ui/states";
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  SkeletonGroup,
  StatCard,
} from "../../../components/ui/surface";

function Story({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      className="awap-card"
      aria-labelledby={`story-${id}-heading`}
      data-testid={`story-${id}`}
    >
      <header className="mb-3">
        <h2 id={`story-${id}-heading`} className="awap-section-title">
          {title}
        </h2>
        <p className="text-sm awap-muted">{description}</p>
      </header>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

export default function DesignSystemPage() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  const [selectValue, setSelectValue] = useState("approve");
  const [comboboxValue, setComboboxValue] = useState("approval");
  const [checkbox, setCheckbox] = useState(true);
  const [radio, setRadio] = useState("manager");
  const [switchOn, setSwitchOn] = useState(true);
  const [tab, setTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const commandItems: CommandItem[] = Array.from({ length: 12 }).map((_, index) => ({
    id: `demo-${index}`,
    label: `${t("designSystem.commandPalette")} ${index + 1}`,
    group: t("shell.commandGroupActions"),
    keywords: ["demo", "command"],
    onSelect: () => toast({ title: `Command ${index + 1}`, variant: "success" }),
  }));

  const rows = [
    { id: "1", name: "Approve expense", state: "OPEN" },
    { id: "2", name: "Publish workflow", state: "PUBLISHED" },
    { id: "3", name: "Scan document", state: "CLEAN" },
  ];

  return (
    <div className="awap-page" data-testid="design-system-page">
      <header className="grid gap-2">
        <h1 className="awap-page-title">{t("designSystem.title")}</h1>
        <p className="awap-reading awap-muted">{t("designSystem.description")}</p>
        <p className="text-sm awap-muted">
          {t("designSystem.componentCount", { count: 32 })} · {t("designSystem.themeHint")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={theme === "light" ? "default" : "outline"}
            onClick={() => setTheme("light")}
            data-testid="theme-light"
          >
            Light
          </Button>
          <Button
            variant={theme === "dark" ? "default" : "outline"}
            onClick={() => setTheme("dark")}
            data-testid="theme-dark"
          >
            Dark
          </Button>
          <p className="awap-truncate max-w-64 text-sm" title={t("designSystem.longText")}>
            {t("designSystem.longText")}
          </p>
        </div>
      </header>

      <Story
        id="buttons"
        title={t("designSystem.buttons")}
        description="Variants, sizes, loading, disabled and icon-only controls."
      >
        <Button>Save</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Cancel</Button>
        <Button variant="destructive">Delete</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
        <IconButton label="Add">
          <Plus className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton label="Settings" variant="outline">
          <Settings className="size-4" aria-hidden="true" />
        </IconButton>
      </Story>

      <Story
        id="form"
        title={t("designSystem.inputs")}
        description="Labelled controls with hints, errors and long-text handling."
      >
        <FormField id="demo-name" label="Full name" hint="As it appears on the request.">
          <Input id="demo-name" defaultValue="Ada Lovelace" aria-describedby="demo-name-hint" />
        </FormField>
        <FormField id="demo-error" label="Work email" error="Use your company address.">
          <Input id="demo-error" defaultValue="ada@" aria-invalid="true" aria-describedby="demo-error-error" />
        </FormField>
        <FormField id="demo-disabled" label="Disabled">
          <Input id="demo-disabled" disabled defaultValue="Read only value" />
        </FormField>
        <FormField id="demo-textarea" label="Notes">
          <Textarea id="demo-textarea" defaultValue="A multi-line note for the approver." />
        </FormField>
        <FormField id="demo-select" label={t("designSystem.select")}>
          <Select
            id="demo-select"
            value={selectValue}
            onChange={(event) => setSelectValue(event.target.value)}
          >
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
            <option value="hold">Hold</option>
          </Select>
        </FormField>
        <DatePicker label={t("designSystem.datePicker")} id="demo-date" defaultValue="2026-11-19" />
        <FileDropzone label={t("designSystem.fileDropzone")} accept=".pdf,.png" />
        <Combobox
          label={t("designSystem.combobox")}
          value={comboboxValue}
          onValueChange={setComboboxValue}
          options={[
            { value: "approval", label: "Approval task" },
            { value: "review", label: "Review task" },
            { value: "notification", label: "Notification" },
          ]}
        />
      </Story>

      <Story
        id="toggles"
        title={`${t("designSystem.checkbox")} / ${t("designSystem.radio")} / ${t("designSystem.switch")}`}
        description="Boolean and single-choice controls with keyboard support."
      >
        <Checkbox label="Notify the requester" checked={checkbox} onChange={(e) => setCheckbox(e.target.checked)} />
        <RadioGroup
          legend="Approver"
          name="approver"
          value={radio}
          onValueChange={setRadio}
          options={[
            { value: "manager", label: "Line manager" },
            { value: "finance", label: "Finance" },
          ]}
        />
        <Switch label="Auto-approve low risk" checked={switchOn} onCheckedChange={setSwitchOn} />
      </Story>

      <Story
        id="surfaces"
        title={`${t("designSystem.badge")} / ${t("designSystem.card")} / ${t("designSystem.avatar")}`}
        description="Surfaces, status badges, avatars and skeletons."
      >
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="primary">Primary</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="muted">Muted</Badge>
        </div>
        <Card className="w-72">
          <CardHeader>
            <CardTitle>Expense approval</CardTitle>
            <CardDescription>Two-step approval with finance review.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">Owner: Ada Lovelace</p>
            <Badge variant="success">Published</Badge>
          </CardContent>
          <CardFooter>
            <Button size="sm">Open</Button>
            <Button size="sm" variant="outline">
              Edit
            </Button>
          </CardFooter>
        </Card>
        <StatCard label="Pending tasks" value={12} detail="+3 since yesterday" tone="warning" />
        <StatCard label="Completed" value={148} detail="This month" tone="success" />
        <Avatar name="Ada Lovelace" />
        <Avatar name="Grace Hopper" size="lg" />
        <SkeletonGroup lines={3} />
      </Story>

      <Story
        id="data"
        title={`${t("designSystem.table")} / ${t("designSystem.tabs")}`}
        description="Tables, data grids, tabs, pagination, steppers, timelines and breadcrumbs."
      >
        <div className="grid w-full gap-4 lg:grid-cols-2">
          <Table>
            <caption className="sr-only">Workflow states</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.state}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <DataGrid
            caption="Data grid"
            rows={rows}
            columns={[
              { key: "name", header: "Name" },
              {
                key: "state",
                header: "State",
                render: (row) => <Badge variant="success">{row.state}</Badge>,
              },
            ]}
            getRowKey={(row) => row.id}
          />
        </div>
        <div className="w-full">
          <Tabs
            ariaLabel="Design system tabs"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: "overview", label: "Overview", content: <p>Overview panel.</p> },
              { value: "activity", label: "Activity", content: <p>Activity panel.</p> },
              { value: "settings", label: "Settings", content: <p>Settings panel.</p> },
            ]}
          />
        </div>
        <Pagination page={page} totalPages={5} onPageChange={setPage} />
        <Stepper
          current={1}
          steps={[
            { label: "Draft" },
            { label: "Review", description: "Manager approval" },
            { label: "Published" },
          ]}
        />
        <Timeline
          items={[
            { id: "1", title: "Created", time: "09:00", description: "Request submitted" },
            { id: "2", title: "Approved", time: "09:15", description: "Manager approved" },
          ]}
        />
        <Breadcrumb
          items={[
            { label: t("breadcrumb.home"), href: "/dashboard" },
            { label: t("designSystem.title") },
          ]}
        />
      </Story>

      <Story
        id="feedback"
        title={t("designSystem.empty")}
        description="Loading, empty, error, forbidden and offline states."
      >
        <div className="grid w-full gap-3 lg:grid-cols-2">
          <LoadingState label={t("designSystem.loading")} />
          <EmptyState message={t("state.empty")} />
          <ErrorState
            error={new ApiError(500, "boom", "corr-demo-123")}
            message={t("state.error")}
          />
          <ForbiddenState message={t("state.forbidden")} />
          <OfflineState message={t("state.offline")} retryLabel={t("state.retry")} onRetry={() => undefined} />
        </div>
      </Story>

      <Story
        id="overlays"
        title={`${t("designSystem.dialog")} / ${t("designSystem.drawer")} / ${t("designSystem.toast")}`}
        description="Focus-trapped overlays, tooltips, menus and the command palette."
      >
        <Button onClick={() => setDialogOpen(true)}>{t("designSystem.openDialog")}</Button>
        <Button variant="outline" onClick={() => setDrawerOpen(true)}>
          {t("designSystem.openDrawer")}
        </Button>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          {t("designSystem.delete")}
        </Button>
        <Button variant="secondary" onClick={() => toast({ title: "Saved", description: "Changes stored.", variant: "success" })}>
          {t("designSystem.showToast")}
        </Button>
        <Button variant="outline" onClick={() => setPaletteOpen(true)}>
          {t("designSystem.commandPalette")}
        </Button>
        <Tooltip label="Download the current report">
          <Button variant="outline">
            <Download className="size-4" aria-hidden="true" />
            Download
          </Button>
        </Tooltip>
        <Popover label="Filters" trigger="Filters">
          <p className="text-sm">Popover content with focusable controls.</p>
          <Button size="sm" className="mt-2">
            Apply
          </Button>
        </Popover>
        <Menu
          label="Row actions"
          trigger="Actions"
          items={[
            { label: "Duplicate", onSelect: () => toast({ title: "Duplicated" }) },
            { label: "Archive", onSelect: () => toast({ title: "Archived" }) },
            { label: "Delete", onSelect: () => toast({ title: "Deleted", variant: "danger" }), danger: true },
          ]}
        />
        <IconButton label="Delete row" variant="destructive">
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </Story>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Start workflow"
        description="Confirm the context before starting the process."
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setDialogOpen(false)}>Start</Button>
          </>
        }
      >
        <FormField id="dialog-context" label="Context JSON">
          <Textarea id="dialog-context" defaultValue='{"source":"design-system"}' />
        </FormField>
      </Dialog>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Filters">
        <p className="text-sm awap-muted">Drawer content. Escape closes and focus returns to the trigger.</p>
        <Checkbox label="Only my tasks" defaultChecked />
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete row?"
        description="This action cannot be undone."
        confirmLabel={t("designSystem.delete")}
        cancelLabel={t("designSystem.cancel")}
        danger
        onConfirm={() => toast({ title: "Deleted", variant: "danger" })}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={commandItems}
        title={t("shell.commandTitle")}
        placeholder={t("shell.commandPlaceholder")}
        emptyLabel={t("shell.commandEmpty")}
      />
    </div>
  );
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import * as api from "../../../lib/api";
import { ToastProvider } from "../../../components/ui/overlays";
import AnalyticsPage from "../analytics/page";
import OrganizationsPage from "../organizations/page";
import TasksPage from "../tasks/page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "task-1" }),
  usePathname: () => "/tasks",
}));

const emptyPercentiles = { p50: null, p90: null, p95: null, p99: null, sampleCount: 0 };

function dashboard(overrides: Partial<api.AnalyticsDashboardDto> = {}): api.AnalyticsDashboardDto {
  return {
    from: "2026-11-01",
    to: "2026-11-15",
    granularity: "DAY",
    timezone: "UTC",
    dataCompleteness: { dailyTotalsAvailable: true, rawEventsAvailable: true, sampleCount: 4 },
    dailyTotals: [
      {
        day: "2026-11-15",
        eventType: "WORKFLOW_COMPLETED",
        count: 2,
        totalDurationMs: 300,
        averageDurationMs: 150,
      },
    ],
    timeBuckets: [{ bucket: "2026-11-15", total: 2, counts: { WORKFLOW_COMPLETED: 2 } }],
    workflowDuration: { p50: 100, p90: 200, p95: 250, p99: 300, sampleCount: 4 },
    taskCycleTime: { p50: 50, p90: 100, p95: 120, p99: 130, sampleCount: 2 },
    approvalLatency: { p50: 10, p90: 20, p95: 25, p99: 30, sampleCount: 2 },
    failureRate: 0.2,
    slaBreachRate: 0.1,
    bottlenecks: [{ nodeId: "approval", count: 2, averageDurationMs: 90, p95DurationMs: 120 }],
    groups: [{ key: "WORKFLOW_COMPLETED", count: 2, averageDurationMs: 150, p95DurationMs: 250 }],
    trend: { currentCount: 4, previousCount: 1, delta: 3 },
    ...overrides,
  };
}

jest.mock("../../../lib/api", () => {
  class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError,
    errorStatus: (error: unknown) => (error instanceof ApiError ? error.status : undefined),
    correlationIdOf: () => undefined,
    fetchAnalyticsOverview: jest.fn(),
    fetchAnalyticsDrilldown: jest.fn(),
    analyticsExportUrl: () => "http://api.test/api/v1/analytics/export",
    listTasks: jest.fn(),
    listMyTasks: jest.fn(),
    runTaskAction: jest.fn(),
    fetchOrganizationTree: jest.fn(),
  };
});

const fetchAnalyticsOverview = api.fetchAnalyticsOverview as jest.MockedFunction<
  typeof api.fetchAnalyticsOverview
>;
const fetchAnalyticsDrilldown = api.fetchAnalyticsDrilldown as jest.MockedFunction<
  typeof api.fetchAnalyticsDrilldown
>;
const listTasks = api.listTasks as jest.MockedFunction<typeof api.listTasks>;
const listMyTasks = api.listMyTasks as jest.MockedFunction<typeof api.listMyTasks>;
const fetchOrganizationTree = api.fetchOrganizationTree as jest.MockedFunction<
  typeof api.fetchOrganizationTree
>;

function renderPage(page: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return { queryClient, ...render(<>{page}</>, { wrapper: Wrapper }) };
}

beforeEach(() => {
  jest.resetAllMocks();
});

function overview(populated: boolean) {
  return {
    dashboard: dashboard(
      populated
        ? undefined
        : {
            dailyTotals: [],
            timeBuckets: [],
            bottlenecks: [],
            groups: [],
            dataCompleteness: {
              dailyTotalsAvailable: true,
              rawEventsAvailable: true,
              sampleCount: 0,
            },
          },
    ),
    eventTotals: populated
      ? [
          {
            eventType: "WORKFLOW_COMPLETED",
            count: 2,
            totalDurationMs: 300,
            averageDurationMs: 150,
          },
          {
            eventType: "WORKFLOW_FAILED",
            count: 1,
            totalDurationMs: 100,
            averageDurationMs: 100,
          },
        ]
      : [],
    totalEvents: populated ? 3 : 0,
  };
}

function drilldown() {
  return {
    from: "2026-11-01",
    to: "2026-11-15",
    eventType: "WORKFLOW_COMPLETED",
    page: 0,
    size: 20,
    totalElements: 1,
    totalPages: 1,
    partial: false,
    detail: null,
    rows: [
      {
        id: "sample-1",
        eventType: "WORKFLOW_COMPLETED",
        workflowInstanceId: "instance-1",
        taskId: null,
        nodeId: "approval",
        durationMs: 150,
        occurredAt: "2026-11-15T10:00:00Z",
      },
    ],
  };
}

describe("page-level query states", () => {
  it("renders the forbidden state for a 403 without retrying", async () => {
    fetchAnalyticsOverview.mockRejectedValue(new api.ApiError(403, "forbidden"));
    renderPage(<AnalyticsPage />);

    expect(await screen.findByTestId("forbidden-state")).toBeInTheDocument();
    expect(fetchAnalyticsOverview).toHaveBeenCalledTimes(1);
  });

  it("renders the error state for a server failure", async () => {
    fetchAnalyticsOverview.mockRejectedValue(new api.ApiError(500, "boom"));
    renderPage(<AnalyticsPage />);
    expect(await screen.findByTestId("error-state")).toHaveTextContent("Failed to load analytics.");
  });

  it("renders the analytics empty state when the window has no data", async () => {
    fetchAnalyticsOverview.mockResolvedValue(overview(false));
    renderPage(<AnalyticsPage />);
    expect(
      await screen.findByText("No analytics recorded in the selected window."),
    ).toBeInTheDocument();
  });

  it("renders the exact server counts and percentiles (T8-01)", async () => {
    fetchAnalyticsOverview.mockResolvedValue(overview(true));
    renderPage(<AnalyticsPage />);

    expect(await screen.findByTestId("analytics-total-events-value")).toHaveTextContent("3");
    expect(screen.getByTestId("analytics-completed-workflows-value")).toHaveTextContent("2");
    expect(screen.getByTestId("analytics-failed-workflows-value")).toHaveTextContent("1");
    expect(screen.getByTestId("analytics-sla-breaches-value")).toHaveTextContent("0");
    expect(screen.getByTestId("analytics-workflow-p95-value")).toHaveTextContent("250 ms");
    expect(screen.getByTestId("analytics-task-p95-value")).toHaveTextContent("120 ms");
    expect(screen.getByTestId("analytics-approval-p95-value")).toHaveTextContent("25 ms");
    expect(screen.getByTestId("analytics-trend-value")).toHaveTextContent("+3");
    expect(screen.getByTestId("analytics-bottleneck-approval")).toHaveTextContent("approval");
  });

  it("opens the drill-down list behind an event card (T8-02)", async () => {
    fetchAnalyticsOverview.mockResolvedValue(overview(true));
    fetchAnalyticsDrilldown.mockResolvedValue(drilldown());
    renderPage(<AnalyticsPage />);

    await screen.findByTestId("analytics-total-events-value");
    const buttons = screen.getAllByRole("button", { name: "Drill down" });
    fireEvent.click(buttons[0]!);

    expect(await screen.findByTestId("analytics-drilldown")).toHaveTextContent(
      "1 sampled event",
    );
    expect(screen.getByTestId("drilldown-row-sample-1")).toHaveTextContent("approval");
  });

  it("renders an explicit partial state when raw events are unavailable (U8-04)", async () => {
    fetchAnalyticsOverview.mockResolvedValue({
      ...overview(true),
      dashboard: dashboard({
        dataCompleteness: {
          dailyTotalsAvailable: true,
          rawEventsAvailable: false,
          sampleCount: 0,
        },
        workflowDuration: emptyPercentiles,
      }),
    });
    renderPage(<AnalyticsPage />);

    expect(await screen.findByTestId("partial-state")).toHaveTextContent(
      "Raw-event analytics are temporarily unavailable.",
    );
  });

  it("rejects a reversed date range before calling the API (U8-07)", async () => {
    fetchAnalyticsOverview.mockResolvedValue(overview(true));
    renderPage(<AnalyticsPage />);

    await screen.findByTestId("analytics-total-events-value");
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2099-12-31" },
    });

    expect(await screen.findByTestId("range-error")).toHaveTextContent(
      "From must not be after to.",
    );
  });

  it("renders the empty inbox state", async () => {
    listTasks.mockResolvedValue([]);
    listMyTasks.mockResolvedValue([]);
    renderPage(<TasksPage />);
    expect(await screen.findByTestId("task-list-empty")).toHaveTextContent(
      "No work items match these filters.",
    );
  });

  it("renders the empty organization state", async () => {
    fetchOrganizationTree.mockResolvedValue([]);
    renderPage(<OrganizationsPage />);
    expect(await screen.findByTestId("empty-state")).toHaveTextContent("No companies yet.");
  });
});

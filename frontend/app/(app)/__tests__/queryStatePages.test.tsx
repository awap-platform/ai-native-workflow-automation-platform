import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import * as api from "../../../lib/api";
import { queryKeys } from "../../../lib/queryKeys";
import AnalyticsPage from "../analytics/page";
import OrganizationsPage from "../organizations/page";
import TasksPage from "../tasks/page";

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
    fetchAnalyticsDashboard: jest.fn(),
    listTasks: jest.fn(),
    fetchOrganizationTree: jest.fn(),
  };
});

const fetchAnalyticsDashboard = api.fetchAnalyticsDashboard as jest.MockedFunction<
  typeof api.fetchAnalyticsDashboard
>;
const listTasks = api.listTasks as jest.MockedFunction<typeof api.listTasks>;
const fetchOrganizationTree = api.fetchOrganizationTree as jest.MockedFunction<
  typeof api.fetchOrganizationTree
>;

function renderPage(page: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, ...render(<>{page}</>, { wrapper: Wrapper }) };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("page-level query states", () => {
  it("renders the forbidden state for a 403 without retrying", async () => {
    fetchAnalyticsDashboard.mockRejectedValue(new api.ApiError(403, "forbidden"));
    const { queryClient } = renderPage(<AnalyticsPage />);

    expect(await screen.findByTestId("forbidden-state")).toBeInTheDocument();
    expect(fetchAnalyticsDashboard).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(queryKeys.analytics.dashboard())?.status).toBe("error");
  });

  it("renders the error state for a server failure", async () => {
    fetchAnalyticsDashboard.mockRejectedValue(new api.ApiError(500, "boom"));
    renderPage(<AnalyticsPage />);
    expect(await screen.findByTestId("error-state")).toHaveTextContent("Failed to load analytics.");
  });

  it("renders the analytics empty state when the window has no data", async () => {
    fetchAnalyticsDashboard.mockResolvedValue(
      dashboard({
        dailyTotals: [],
        timeBuckets: [],
        bottlenecks: [],
        groups: [],
        dataCompleteness: {
          dailyTotalsAvailable: true,
          rawEventsAvailable: true,
          sampleCount: 0,
        },
      }),
    );
    renderPage(<AnalyticsPage />);
    expect(
      await screen.findByText("No analytics recorded in the selected window."),
    ).toBeInTheDocument();
  });

  it("renders the exact advanced values returned by the API contract", async () => {
    fetchAnalyticsDashboard.mockResolvedValue(dashboard());
    renderPage(<AnalyticsPage />);

    expect(await screen.findByTestId("analytics-sla-breach-rate-value")).toHaveTextContent("10.0%");
    expect(screen.getByTestId("analytics-workflow-p95-value")).toHaveTextContent("250 ms");
    expect(screen.getByTestId("analytics-task-cycle-p95-value")).toHaveTextContent("120 ms");
    expect(screen.getByTestId("analytics-approval-latency-p95-value")).toHaveTextContent("25 ms");
    expect(screen.getByTestId("analytics-trend-value")).toHaveTextContent("+3");
    expect(screen.getByTestId("analytics-bottleneck-approval")).toHaveTextContent("approval");
    expect(screen.getByTestId("analytics-bucket-2026-11-15")).toHaveTextContent(
      "WORKFLOW_COMPLETED: 2",
    );
    expect(screen.getByTestId("analytics-row-WORKFLOW_COMPLETED")).toHaveTextContent("150 ms");
  });

  it("renders an explicit partial state when raw events are unavailable", async () => {
    fetchAnalyticsDashboard.mockResolvedValue(
      dashboard({
        dataCompleteness: {
          dailyTotalsAvailable: true,
          rawEventsAvailable: false,
          sampleCount: 0,
        },
        workflowDuration: emptyPercentiles,
      }),
    );
    renderPage(<AnalyticsPage />);

    expect(await screen.findByTestId("analytics-partial-state")).toHaveTextContent(
      "Raw-event analytics are temporarily unavailable.",
    );
  });

  it("renders the empty task list state", async () => {
    listTasks.mockResolvedValue([]);
    renderPage(<TasksPage />);
    expect(await screen.findByTestId("empty-state")).toHaveTextContent("No tasks yet.");
  });

  it("renders the empty organization state", async () => {
    fetchOrganizationTree.mockResolvedValue([]);
    renderPage(<OrganizationsPage />);
    expect(await screen.findByTestId("empty-state")).toHaveTextContent("No companies yet.");
  });
});

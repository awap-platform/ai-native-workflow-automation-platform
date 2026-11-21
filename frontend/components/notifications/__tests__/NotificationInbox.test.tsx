import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import type { NotificationDeliveryDto } from "../../../lib/api";
import * as api from "../../../lib/api";
import NotificationInbox from "../NotificationInbox";

jest.mock("../../../lib/api", () => ({
  listNotifications: jest.fn(),
  fetchUnreadNotificationCount: jest.fn(),
  markNotificationRead: jest.fn(),
  markNotificationUnread: jest.fn(),
  listNotificationSuppressions: jest.fn(),
}));

const listNotifications = api.listNotifications as jest.MockedFunction<
  typeof api.listNotifications
>;
const fetchUnreadNotificationCount = api.fetchUnreadNotificationCount as jest.MockedFunction<
  typeof api.fetchUnreadNotificationCount
>;
const markNotificationRead = api.markNotificationRead as jest.MockedFunction<
  typeof api.markNotificationRead
>;
const markNotificationUnread = api.markNotificationUnread as jest.MockedFunction<
  typeof api.markNotificationUnread
>;
const listNotificationSuppressions = api.listNotificationSuppressions as jest.MockedFunction<
  typeof api.listNotificationSuppressions
>;

function notification(overrides: Partial<NotificationDeliveryDto> = {}): NotificationDeliveryDto {
  return {
    id: "n1",
    channel: "WEB",
    recipient: "user@example.com",
    templateKey: "welcome",
    status: "SENT",
    attempts: 1,
    lastError: null,
    createdAt: "2026-02-01T10:00:00Z",
    read: false,
    readAt: null,
    ...overrides,
  };
}

function renderInbox(ui: ReactElement = <NotificationInbox />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.resetAllMocks();
  listNotificationSuppressions.mockResolvedValue([]);
});

describe("NotificationInbox", () => {
  it("renders the unread badge with an accessible label", async () => {
    listNotifications.mockResolvedValue([notification()]);
    fetchUnreadNotificationCount.mockResolvedValue({ count: 1 });

    renderInbox();

    const badge = await screen.findByTestId("unread-badge");
    await waitFor(() => expect(badge).toHaveTextContent("1"));
    expect(badge).toHaveAttribute("aria-label", "Unread notifications: 1");
    expect(badge).toHaveAttribute("role", "status");
    expect(await screen.findByTestId("state-n1")).toHaveTextContent("Unread");
  });

  it("marks a notification read, decrements the badge and exposes the unread action", async () => {
    let read = false;
    listNotifications.mockImplementation(async () => [
      notification({ read, readAt: read ? "2026-02-01T11:00:00Z" : null }),
    ]);
    fetchUnreadNotificationCount.mockImplementation(async () => ({ count: read ? 0 : 1 }));
    markNotificationRead.mockImplementation(async () => {
      read = true;
      return notification({ read: true, readAt: "2026-02-01T11:00:00Z" });
    });

    renderInbox();

    const markReadButton = await screen.findByRole("button", {
      name: 'Mark notification "welcome" as read',
    });
    fireEvent.click(markReadButton);

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith("n1"));
    await waitFor(() =>
      expect(screen.getByTestId("unread-badge")).toHaveAttribute(
        "aria-label",
        "Unread notifications: 0",
      ),
    );
    expect(await screen.findByTestId("state-n1")).toHaveTextContent("Read");
    expect(
      await screen.findByRole("button", { name: 'Mark notification "welcome" as unread' }),
    ).toBeInTheDocument();
  });

  it("restores a notification to unread and increases the badge", async () => {
    let read = true;
    listNotifications.mockImplementation(async () => [
      notification({ read, readAt: read ? "2026-02-01T11:00:00Z" : null }),
    ]);
    fetchUnreadNotificationCount.mockImplementation(async () => ({ count: read ? 0 : 1 }));
    markNotificationUnread.mockImplementation(async () => {
      read = false;
      return notification({ read: false, readAt: null });
    });

    renderInbox();

    const markUnreadButton = await screen.findByRole("button", {
      name: 'Mark notification "welcome" as unread',
    });
    fireEvent.click(markUnreadButton);

    await waitFor(() => expect(markNotificationUnread).toHaveBeenCalledWith("n1"));
    await waitFor(() => expect(screen.getByTestId("unread-badge")).toHaveTextContent("1"));
    expect(await screen.findByTestId("state-n1")).toHaveTextContent("Unread");
  });

  it("filters by read state, channel, delivery status and search text", async () => {
    listNotifications.mockResolvedValue([
      notification({ id: "n1", templateKey: "welcome", read: false, channel: "EMAIL" }),
      notification({
        id: "n2",
        templateKey: "digest",
        read: true,
        channel: "WEB",
        status: "FAILED",
        recipient: "ops@example.com",
      }),
    ]);
    fetchUnreadNotificationCount.mockResolvedValue({ count: 1 });

    renderInbox();
    await screen.findByTestId("notification-n1");

    fireEvent.change(screen.getByTestId("notification-filter-read"), {
      target: { value: "unread" },
    });
    expect(screen.queryByTestId("notification-n2")).not.toBeInTheDocument();
    expect(screen.getByTestId("notification-filter-count")).toHaveTextContent("Showing 1 of 2");

    fireEvent.change(screen.getByTestId("notification-filter-read"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByTestId("notification-filter-status"), {
      target: { value: "FAILED" },
    });
    expect(screen.queryByTestId("notification-n1")).not.toBeInTheDocument();
    expect(screen.getByTestId("notification-n2")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("notification-filter-status"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("notification-search"), {
      target: { value: "ops@" },
    });
    expect(screen.getByTestId("notification-n2")).toBeInTheDocument();
    expect(screen.queryByTestId("notification-n1")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("notification-search"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("notification-filter-channel"), {
      target: { value: "EMAIL" },
    });
    expect(screen.getByTestId("notification-n1")).toBeInTheDocument();
    expect(screen.queryByTestId("notification-n2")).not.toBeInTheDocument();
  });

  it("marks selected notifications read in bulk and reports the result", async () => {
    listNotifications.mockResolvedValue([
      notification({ id: "n1", templateKey: "welcome" }),
      notification({ id: "n2", templateKey: "digest" }),
    ]);
    fetchUnreadNotificationCount.mockResolvedValue({ count: 2 });
    markNotificationRead.mockResolvedValue(notification({ read: true }));

    renderInbox();
    await screen.findByTestId("notification-n1");

    fireEvent.click(screen.getByRole("checkbox", { name: 'Select notification "welcome"' }));
    fireEvent.click(screen.getByRole("checkbox", { name: 'Select notification "digest"' }));
    fireEvent.click(screen.getByRole("button", { name: "Mark selected as read" }));

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledTimes(2));
    expect(markNotificationRead).toHaveBeenCalledWith("n1");
    expect(markNotificationRead).toHaveBeenCalledWith("n2");
    expect(await screen.findByTestId("bulk-result")).toHaveTextContent("2 updated.");
  });

  it("exposes delivery retry state and the last error", async () => {
    listNotifications.mockResolvedValue([
      notification({
        status: "RETRYING",
        attempts: 2,
        nextAttemptAt: "2026-02-01T10:05:00Z",
        lastError: "provider timeout",
      }),
    ]);
    fetchUnreadNotificationCount.mockResolvedValue({ count: 1 });

    renderInbox();

    expect(await screen.findByTestId("notification-status-n1")).toHaveTextContent("RETRYING");
    expect(screen.getByTestId("notification-attempts-n1")).toHaveTextContent("2 attempts");
    expect(screen.getByTestId("notification-next-attempt-n1")).toBeInTheDocument();
    expect(screen.getByTestId("notification-error-n1")).toHaveTextContent("provider timeout");
    expect(screen.getByTestId("delivery-health")).toHaveTextContent("0 pending · 1 retrying");
  });

  it("shows suppressed recipients and their block reason", async () => {
    listNotifications.mockResolvedValue([notification()]);
    fetchUnreadNotificationCount.mockResolvedValue({ count: 1 });
    listNotificationSuppressions.mockResolvedValue([
      {
        id: "s1",
        channel: "EMAIL",
        recipient: "bounce@example.com",
        reason: "SMTP_BOUNCE",
        createdAt: "2026-02-01T09:00:00Z",
      },
    ]);

    renderInbox();

    const row = await screen.findByTestId("suppression-s1");
    expect(row).toHaveTextContent("EMAIL");
    expect(row).toHaveTextContent("bounce@example.com");
    expect(row).toHaveTextContent("SMTP_BOUNCE");
    expect(screen.getByTestId("delivery-health")).toHaveTextContent("1 suppressed");
  });

  it("shows an empty state when the tenant has no notifications", async () => {
    listNotifications.mockResolvedValue([]);
    fetchUnreadNotificationCount.mockResolvedValue({ count: 0 });

    renderInbox();

    expect(await screen.findByText("You have no notifications.")).toBeInTheDocument();
    expect(screen.getByTestId("unread-badge")).toHaveTextContent("0");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("surfaces a load failure as an alert", async () => {
    listNotifications.mockRejectedValue(new Error("boom"));
    fetchUnreadNotificationCount.mockRejectedValue(new Error("boom"));

    renderInbox();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Notifications could not be loaded.",
    );
  });
});

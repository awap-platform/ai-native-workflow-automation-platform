"use client";

import { useMemo, useState } from "react";
import type { NotificationDeliveryDto } from "../../lib/api";
import { formatUtcDateTime } from "../../lib/format";
import {
  useBulkNotificationRead,
  useNotificationSuppressions,
  useNotifications,
  useToggleNotificationRead,
  useUnreadNotificationCount,
} from "../../lib/hooks/useNotifications";

/** Human readable label for a delivery, used in the action's accessible name. */
export function notificationLabel(notification: NotificationDeliveryDto): string {
  return notification.templateKey ?? notification.channel;
}

type ReadFilter = "all" | "unread" | "read";

const READ_FILTERS: ReadFilter[] = ["all", "unread", "read"];

const READ_FILTER_LABELS: Record<ReadFilter, string> = {
  all: "All",
  unread: "Unread",
  read: "Read",
};

const DELIVERY_STATUSES = ["", "PENDING", "RETRYING", "SENT", "FAILED"];

const CHANNELS = ["", "EMAIL", "SMS", "PUSH", "WEB", "WEBHOOK"];

/**
 * Tenant notification inbox with read/unread state, filters, bulk actions, delivery-retry details
 * and the suppression list that explains why a recipient is no longer contacted.
 */
export default function NotificationInbox() {
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();
  const suppressions = useNotificationSuppressions();
  const { toggle, pendingId, error } = useToggleNotificationRead();
  const bulk = useBulkNotificationRead();

  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const count = unreadCount.data?.count ?? 0;
  const items = useMemo(() => notifications.data ?? [], [notifications.data]);
  const suppressionItems = useMemo(() => suppressions.data ?? [], [suppressions.data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((notification) => {
      if (readFilter === "unread" && notification.read) {
        return false;
      }
      if (readFilter === "read" && !notification.read) {
        return false;
      }
      if (channelFilter && notification.channel !== channelFilter) {
        return false;
      }
      if (statusFilter && notification.status !== statusFilter) {
        return false;
      }
      if (needle) {
        const haystack = `${notification.recipient} ${notification.templateKey ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      return true;
    });
  }, [channelFilter, items, readFilter, search, statusFilter]);

  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id));
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((notification) => selected.has(notification.id));

  const retrying = items.filter((notification) => notification.status === "RETRYING").length;
  const failed = items.filter((notification) => notification.status === "FAILED").length;
  const pending = items.filter((notification) => notification.status === "PENDING").length;

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filtered.forEach((notification) => next.delete(notification.id));
      } else {
        filtered.forEach((notification) => next.add(notification.id));
      }
      return next;
    });
  }

  function runBulk(read: boolean) {
    bulk.mutate(
      { ids: selectedIds, read },
      {
        onSuccess: () => setSelected(new Set()),
      },
    );
  }

  return (
    <section className="awap-page awap-reading" aria-labelledby="notification-inbox-heading">
      <header className="awap-card-header">
        <h1 id="notification-inbox-heading" className="awap-page-title">
          Notifications
        </h1>
        <span
          role="status"
          aria-live="polite"
          aria-label={`Unread notifications: ${count}`}
          data-testid="unread-badge"
          className={`awap-badge ${count > 0 ? "awap-badge-active" : ""}`}
        >
          {count}
        </span>
      </header>

      <section aria-labelledby="delivery-health-heading" data-testid="delivery-health">
        <h2 id="delivery-health-heading" className="awap-section-title">
          Delivery health
        </h2>
        <p className="awap-muted m-0">
          {pending} pending · {retrying} retrying · {failed} failed · {suppressionItems.length}{" "}
          suppressed. A suppressed recipient is blocked before the provider call and is not retried.
        </p>
      </section>

      {notifications.isLoading || unreadCount.isLoading ? (
        <p role="status">Loading notifications…</p>
      ) : null}

      {notifications.isError || unreadCount.isError ? (
        <p role="alert" className="awap-error">
          Notifications could not be loaded.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="awap-error">
          The notification could not be updated.
        </p>
      ) : null}

      {bulk.data ? (
        <p role="status" aria-live="polite" data-testid="bulk-result" className="awap-alert m-0">
          {bulk.data.updated} updated
          {bulk.data.failed > 0 ? `, ${bulk.data.failed} failed` : ""}.
        </p>
      ) : null}

      <div className="awap-toolbar" role="search" aria-label="Notification filters">
        <div className="awap-field">
          <label htmlFor="notification-filter-read">Read state</label>
          <select
            id="notification-filter-read"
            data-testid="notification-filter-read"
            className="awap-select"
            value={readFilter}
            onChange={(event) => setReadFilter(event.target.value as ReadFilter)}
          >
            {READ_FILTERS.map((value) => (
              <option key={value} value={value}>
                {READ_FILTER_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="awap-field">
          <label htmlFor="notification-filter-channel">Channel</label>
          <select
            id="notification-filter-channel"
            data-testid="notification-filter-channel"
            className="awap-select"
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value)}
          >
            <option value="">All channels</option>
            {CHANNELS.filter((channel) => channel !== "").map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
        </div>
        <div className="awap-field">
          <label htmlFor="notification-filter-status">Delivery status</label>
          <select
            id="notification-filter-status"
            data-testid="notification-filter-status"
            className="awap-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {DELIVERY_STATUSES.filter((status) => status !== "").map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="awap-field awap-field-grow">
          <label htmlFor="notification-search">Search recipient or template</label>
          <input
            id="notification-search"
            data-testid="notification-search"
            className="awap-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <p className="awap-muted m-0" role="status" aria-live="polite" data-testid="notification-filter-count">
        Showing {filtered.length} of {items.length} notifications.
      </p>

      {selectedIds.length > 0 ? (
        <div className="awap-selection-bar" role="group" aria-label="Bulk notification actions">
          <span>{selectedIds.length} selected</span>
          <button
            type="button"
            className="awap-button"
            disabled={bulk.isPending}
            onClick={() => runBulk(true)}
          >
            Mark selected as read
          </button>
          <button
            type="button"
            className="awap-button"
            disabled={bulk.isPending}
            onClick={() => runBulk(false)}
          >
            Mark selected as unread
          </button>
          <button type="button" className="awap-button awap-button-ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}

      {!notifications.isLoading && !notifications.isError && items.length === 0 ? (
        <p className="awap-empty">You have no notifications.</p>
      ) : null}

      {items.length > 0 && filtered.length === 0 ? (
        <p className="awap-empty">No notifications match the current filters.</p>
      ) : null}

      <ul className="awap-list" aria-label="Notifications">
        {items.length > 0 ? (
          <li className="awap-inline">
            <input
              id="notification-select-all"
              type="checkbox"
              aria-label="Select all notifications"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
            />
            <label htmlFor="notification-select-all">Select all shown</label>
          </li>
        ) : null}
        {filtered.map((notification) => {
          const label = notificationLabel(notification);
          const action = notification.read ? "unread" : "read";
          return (
            <li
              key={notification.id}
              data-testid={`notification-${notification.id}`}
              className={`awap-list-row ${selected.has(notification.id) ? "awap-row-selected" : ""}`}
            >
              <div className="awap-inline">
                <input
                  type="checkbox"
                  aria-label={`Select notification "${label}"`}
                  checked={selected.has(notification.id)}
                  onChange={() => toggleSelected(notification.id)}
                />
                <div>
                  <p className={notification.read ? "m-0" : "m-0 font-semibold"}>{label}</p>
                  <p className="m-0 mt-1 text-xs awap-muted">
                    {notification.recipient} · {formatUtcDateTime(notification.createdAt)} ·{" "}
                    <span data-testid={`state-${notification.id}`}>
                      {notification.read ? "Read" : "Unread"}
                    </span>
                  </p>
                  <p className="m-0 text-xs awap-muted">
                    Delivery <span data-testid={`notification-status-${notification.id}`}>{notification.status}</span>
                    {" · "}
                    <span data-testid={`notification-attempts-${notification.id}`}>
                      {notification.attempts} attempt{notification.attempts === 1 ? "" : "s"}
                    </span>
                    {notification.nextAttemptAt ? (
                      <>
                        {" · next retry "}
                        <span data-testid={`notification-next-attempt-${notification.id}`}>
                          {formatUtcDateTime(notification.nextAttemptAt)}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {notification.lastError ? (
                    <p className="awap-danger-text m-0 text-xs" data-testid={`notification-error-${notification.id}`}>
                      {notification.lastError}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="awap-button"
                onClick={() => toggle(notification)}
                disabled={pendingId === notification.id}
                aria-label={`Mark notification "${label}" as ${action}`}
              >
                {notification.read ? "Mark as unread" : "Mark as read"}
              </button>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="notification-suppressions-heading" className="awap-stack">
        <h2 id="notification-suppressions-heading" className="awap-section-title">
          Suppressed recipients
        </h2>
        <p className="awap-muted m-0">
          Sends to these recipients are blocked before the provider call. Bounces and complaints are
          permanent, so they are never retried.
        </p>
        {suppressions.isLoading ? <p role="status">Loading suppressed recipients…</p> : null}
        {suppressions.isError ? (
          <p role="alert" className="awap-error">
            Suppressed recipients could not be loaded.
          </p>
        ) : null}
        {suppressions.isSuccess && suppressionItems.length === 0 ? (
          <p className="awap-muted">No suppressed recipients.</p>
        ) : null}
        {suppressionItems.length > 0 ? (
          <div className="awap-table-wrap">
            <table className="awap-table" aria-label="Suppressed recipients">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Since</th>
                </tr>
              </thead>
              <tbody>
                {suppressionItems.map((suppression) => (
                  <tr key={suppression.id} data-testid={`suppression-${suppression.id}`}>
                    <td>{suppression.channel}</td>
                    <td>{suppression.recipient}</td>
                    <td className="awap-danger-text">{suppression.reason}</td>
                    <td>{formatUtcDateTime(suppression.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  );
}

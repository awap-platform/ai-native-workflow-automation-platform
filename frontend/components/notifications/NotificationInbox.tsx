"use client";

import type { NotificationDeliveryDto } from "../../lib/api";
import { formatUtcDateTime } from "../../lib/format";
import {
  useNotifications,
  useToggleNotificationRead,
  useUnreadNotificationCount,
} from "../../lib/hooks/useNotifications";

/** Human readable label for a delivery, used in the action's accessible name. */
export function notificationLabel(notification: NotificationDeliveryDto): string {
  return notification.templateKey ?? notification.channel;
}

/** Tenant notification inbox with an unread badge and read/unread actions. */
export default function NotificationInbox() {
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();
  const { toggle, pendingId, error } = useToggleNotificationRead();

  const count = unreadCount.data?.count ?? 0;
  const items = notifications.data ?? [];

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

      {!notifications.isLoading && !notifications.isError && items.length === 0 ? (
        <p className="awap-empty">You have no notifications.</p>
      ) : null}

      <ul className="awap-list" aria-label="Notifications">
        {items.map((notification) => {
          const label = notificationLabel(notification);
          const action = notification.read ? "unread" : "read";
          return (
            <li
              key={notification.id}
              data-testid={`notification-${notification.id}`}
              className="awap-list-row"
            >
              <div>
                <p className={notification.read ? "m-0" : "m-0 font-semibold"}>{label}</p>
                <p className="m-0 mt-1 text-xs awap-muted">
                  {notification.recipient} · {formatUtcDateTime(notification.createdAt)} ·{" "}
                  <span data-testid={`state-${notification.id}`}>
                    {notification.read ? "Read" : "Unread"}
                  </span>
                </p>
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
    </section>
  );
}

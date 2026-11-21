import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchUnreadNotificationCount,
  listNotifications,
  listNotificationSuppressions,
  markNotificationRead,
  markNotificationUnread,
  type NotificationDeliveryDto,
} from "../api";
import { queryKeys } from "../queryKeys";

/** Kept for callers that invalidate the whole inbox. */
export const NOTIFICATIONS_QUERY_KEY = queryKeys.notifications.all;
export const UNREAD_COUNT_QUERY_KEY = queryKeys.notifications.unreadCount();

/** Loads the tenant notification inbox. */
export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: queryKeys.notifications.list(unreadOnly),
    queryFn: () => listNotifications(unreadOnly),
  });
}

/** Loads the unread badge count. */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: fetchUnreadNotificationCount,
  });
}

/** Loads the bounce/complaint suppression list for delivery operations. */
export function useNotificationSuppressions() {
  return useQuery({
    queryKey: queryKeys.notifications.suppressions(),
    queryFn: listNotificationSuppressions,
  });
}

async function invalidateInbox(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY }),
  ]);
}

/** Marks one notification read and refreshes the list and the badge. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => invalidateInbox(queryClient),
  });
}

/** Restores one notification to unread and refreshes the list and the badge. */
export function useMarkNotificationUnread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationUnread(id),
    onSuccess: () => invalidateInbox(queryClient),
  });
}

/** Read-state toggle used by the inbox action button. */
export function useToggleNotificationRead() {
  const markRead = useMarkNotificationRead();
  const markUnread = useMarkNotificationUnread();
  return {
    toggle: (notification: NotificationDeliveryDto) => {
      if (notification.read) {
        markUnread.mutate(notification.id);
      } else {
        markRead.mutate(notification.id);
      }
    },
    pendingId: markRead.isPending
      ? markRead.variables
      : markUnread.isPending
        ? markUnread.variables
        : null,
    error: markRead.error ?? markUnread.error,
  };
}

export interface BulkReadResult {
  updated: number;
  failed: number;
}

/**
 * Bulk read/unread action.
 *
 * <p>The API exposes per-notification idempotent PATCH transitions, so a bulk action fans out and
 * settles every request. A partial failure reports both counts instead of claiming success; the
 * list is refreshed either way so the rows converge with the server.
 */
export function useBulkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, read }: { ids: string[]; read: boolean }): Promise<BulkReadResult> => {
      const settled = await Promise.allSettled(
        ids.map((id) => (read ? markNotificationRead(id) : markNotificationUnread(id))),
      );
      const failed = settled.filter((result) => result.status === "rejected").length;
      return { updated: settled.length - failed, failed };
    },
    onSuccess: () => invalidateInbox(queryClient),
  });
}

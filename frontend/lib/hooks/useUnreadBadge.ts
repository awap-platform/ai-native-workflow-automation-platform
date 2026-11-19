"use client";

import { useEffect, useState } from "react";
import { fetchUnreadNotificationCountSilent } from "../api";

/**
 * Non-blocking unread badge for shell chrome.
 *
 * It deliberately bypasses the auth-refresh pipeline: a stale session must not
 * log the user out from a background badge request. Failures collapse to zero
 * and the page's own data query still handles authentication normally.
 */
export function useUnreadBadge(pathname: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchUnreadNotificationCountSilent().then((data) => {
      if (active) {
        setCount(data?.count ?? 0);
      }
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  return count;
}

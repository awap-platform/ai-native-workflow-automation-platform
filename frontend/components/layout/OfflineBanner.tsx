"use client";

import { useEffect, useState } from "react";

/**
 * Global connectivity banner. It renders only after mount so the server-rendered
 * markup and the first client render agree (no hydration mismatch), then tracks
 * the browser's `online`/`offline` events.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) {
    return null;
  }

  return (
    <div className="awap-banner awap-alert-warning" role="status" data-testid="offline-banner">
      <span>You are offline. Changes may not be saved; retry when the connection returns.</span>
      <button type="button" className="awap-button" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  );
}

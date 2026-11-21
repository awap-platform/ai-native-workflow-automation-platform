"use client";

import { useSyncExternalStore } from "react";
import { useFeatureFlag } from "../../lib/featureFlagContext";

export const TOUR_STORAGE_KEY = "awap.tour.release-readiness.v1";

/**
 * Dismissible in-app tour / training note (UI/UX phase 10).
 *
 * Gated by the `in_app_tour` flag. The dismissal lives in `localStorage` and is
 * read through `useSyncExternalStore`, so the server snapshot (dismissed) and
 * the first client render agree and no state is set inside an effect.
 */

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  // The tour is revealed after hydration so the server markup never depends on storage.
  return true;
}

function dismissTour(): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // Storage can be unavailable in private mode; the in-memory listeners still hide it.
  }
  for (const listener of listeners) {
    listener();
  }
}

export default function InAppTour() {
  const enabled = useFeatureFlag("in_app_tour");
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!enabled || dismissed) {
    return null;
  }

  return (
    <aside className="awap-card awap-tour" aria-labelledby="awap-tour-heading" data-testid="in-app-tour">
      <h2 id="awap-tour-heading" className="awap-section-title">
        Getting started
      </h2>
      <ol className="awap-tour__steps">
        <li>Open the inbox to approve or reject the tasks assigned to you.</li>
        <li>Start a published workflow from the workflow catalogue.</li>
        <li>Ask the Copilot a question; it cites the documents it used.</li>
        <li>Use the audit and operate consoles to trace any instance.</li>
      </ol>
      <p className="awap-muted">
        Press Ctrl+K (Cmd+K on macOS) anywhere to open the command palette. This note stays until you
        dismiss it and can be re-enabled by clearing site storage.
      </p>
      <button type="button" className="awap-button" onClick={dismissTour} data-testid="dismiss-tour">
        Dismiss tour
      </button>
    </aside>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import {
  assessBrowserSupport,
  detectBrowserCapabilities,
  isSlowConnection,
} from "../../lib/browserSupport";

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

interface FallbackSnapshot {
  slow: boolean;
  missing: string[];
  assetsFailed: boolean;
}

const EMPTY: FallbackSnapshot = { slow: false, missing: [], assetsFailed: false };

/**
 * Degraded-mode notices (UI/UX phase 10): slow connection, an unsupported
 * browser and failed static assets (CDN failure).
 *
 * The browser signals live in a module-level external store, so the component
 * subscribes with `useSyncExternalStore` instead of setting state inside an
 * effect. The server snapshot is "nothing wrong", so the first hydration render
 * matches and the notices appear only after the browser capabilities are read.
 */

let snapshot: FallbackSnapshot | null = null;
let assetsFailed = false;
const listeners = new Set<() => void>();

function connectionInfo(): NetworkInformation | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

function computeSnapshot(): FallbackSnapshot {
  const connection = connectionInfo();
  const support = assessBrowserSupport(detectBrowserCapabilities());
  return {
    slow: isSlowConnection(connection?.effectiveType, connection?.saveData),
    missing: support.missing,
    assetsFailed,
  };
}

function getSnapshot(): FallbackSnapshot {
  snapshot ??= computeSnapshot();
  return snapshot;
}

function getServerSnapshot(): FallbackSnapshot {
  return EMPTY;
}

function updateSnapshot(): void {
  const next = computeSnapshot();
  const previous = snapshot;
  if (
    previous &&
    previous.slow === next.slow &&
    previous.assetsFailed === next.assetsFailed &&
    previous.missing.join("|") === next.missing.join("|")
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  const connection = connectionInfo();
  connection?.addEventListener?.("change", updateSnapshot);

  const onResourceError = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (["SCRIPT", "LINK", "IMG"].includes(target.tagName)) {
      assetsFailed = true;
      updateSnapshot();
    }
  };
  window.addEventListener("error", onResourceError, true);

  updateSnapshot();

  return () => {
    listeners.delete(onStoreChange);
    connection?.removeEventListener?.("change", updateSnapshot);
    window.removeEventListener("error", onResourceError, true);
  };
}

export default function FallbackNotices() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <>
      {state.slow ? (
        <div className="awap-banner awap-alert-warning" role="status" data-testid="slow-connection-banner">
          <span>
            Your connection looks slow. Content may take longer to load; skeleton placeholders stay
            visible until the data arrives.
          </span>
        </div>
      ) : null}
      {state.missing.length > 0 ? (
        <div
          className="awap-banner awap-alert-warning"
          role="status"
          data-testid="unsupported-browser-banner"
        >
          <span>
            Your browser is missing {state.missing.join(", ")}. Some features may not work; see
            COMPATIBILITY.md for the supported browsers.
          </span>
        </div>
      ) : null}
      {state.assetsFailed ? (
        <div className="awap-banner awap-alert-danger" role="alert" data-testid="asset-failure-banner">
          <span>Some application files failed to load. Reload to fetch them again.</span>
          <button type="button" className="awap-button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : null}
    </>
  );
}

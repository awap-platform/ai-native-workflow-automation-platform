"use client";

import { Button } from "./button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PartialState,
  StaleState,
} from "./QueryState";

export { EmptyState, ErrorState, LoadingState, PartialState, StaleState };

/** 403 screen for an authenticated user without the required role. */
export function ForbiddenState({
  message = "You do not have permission to view this.",
}: {
  message?: string;
}) {
  return (
    <div role="alert" data-testid="forbidden-state" className="awap-error">
      <span>{message}</span>
    </div>
  );
}

/** Offline notice with an explicit retry action. */
export function OfflineState({
  message = "You are offline. Changes may not be saved.",
  retryLabel = "Retry",
  onRetry,
}: {
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="status" data-testid="offline-state" className="awap-alert awap-alert-warning">
      <span>{message}</span>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Skeleton alias used by the design-system catalog. */
export const SkeletonState = LoadingState;

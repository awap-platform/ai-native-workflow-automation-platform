"use client";

import type { ReactNode } from "react";
import { correlationIdOf } from "../../lib/api";
import { isForbiddenError } from "../../lib/queryClient";

/**
 * Standard loading state used by every server-data screen. The visible text is
 * announced through a live region while the skeleton keeps layout stable.
 */
export function LoadingState({ label = "Loading…" }: { label?: string | undefined }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="loading-state"
      className="awap-card"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="awap-skeleton awap-skeleton-title block" />
      <span aria-hidden="true" className="awap-skeleton awap-skeleton-line block" />
      <span aria-hidden="true" className="awap-skeleton awap-skeleton-line block" />
      <span aria-hidden="true" className="block w-2/3 awap-skeleton awap-skeleton-line" />
    </div>
  );
}

/**
 * Standard error state. A 403 renders the forbidden copy (the user is
 * authenticated but lacks the permission) and is never retried by the query
 * layer, so this state is terminal. When the API supplied a correlation ID it is
 * rendered so a user can quote it to support.
 */
export function ErrorState({
  error,
  message = "Something went wrong.",
  forbiddenMessage = "You do not have permission to view this.",
}: {
  error?: unknown;
  message?: string | undefined;
  forbiddenMessage?: string | undefined;
}) {
  const correlationId = correlationIdOf(error);

  if (isForbiddenError(error)) {
    return (
      <div role="alert" data-testid="forbidden-state" className="awap-error">
        <span>{forbiddenMessage}</span>
        {correlationId ? (
          <span className="awap-correlation">Correlation ID: {correlationId}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div role="alert" data-testid="error-state" className="awap-error">
      <span>{message}</span>
      {correlationId ? (
        <span className="awap-correlation">Correlation ID: {correlationId}</span>
      ) : null}
    </div>
  );
}

/** Standard empty state for a successful but empty collection. */
export function EmptyState({
  message,
  testId = "empty-state",
  action,
}: {
  message: string;
  testId?: string;
  action?: ReactNode;
}) {
  return (
    <div data-testid={testId} className="awap-empty">
      <p>{message}</p>
      {action}
    </div>
  );
}

/** Non-blocking notice for a stale or partially loaded result set. */
export function StaleState({ message }: { message: string }) {
  return (
    <p role="status" data-testid="stale-state" className="awap-alert awap-alert-warning">
      {message}
    </p>
  );
}

/** Non-blocking notice for a partial response (some panels could not load). */
export function PartialState({ message }: { message: string }) {
  return (
    <p role="status" data-testid="partial-state" className="awap-alert awap-alert-warning">
      {message}
    </p>
  );
}

/**
 * Small helper for the common "loading / forbidden / error / empty / content"
 * decision so pages do not reimplement slightly different branches.
 */
export function QueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  loadingLabel,
  errorMessage,
  emptyMessage,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty?: boolean;
  loadingLabel?: string | undefined;
  errorMessage?: string | undefined;
  emptyMessage?: string | undefined;
  children: ReactNode;
}) {
  if (isLoading) {
    return <LoadingState label={loadingLabel} />;
  }
  if (isError) {
    return <ErrorState error={error} message={errorMessage} />;
  }
  if (isEmpty && emptyMessage) {
    return <EmptyState message={emptyMessage} />;
  }
  return <>{children}</>;
}

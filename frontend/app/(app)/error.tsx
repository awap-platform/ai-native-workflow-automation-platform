"use client";

import { useEffect } from "react";
import { correlationIdOf } from "../../lib/api";

/**
 * Route-level error boundary. It renders the standard error surface with a
 * correlation ID (or Next.js digest) so a user can quote one identifier to
 * support and the exact request is traceable.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("route-error", error);
  }, [error]);

  const reference = correlationIdOf(error) ?? error.digest;

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">Something went wrong</h1>
      <div role="alert" className="awap-error">
        <p>
          This screen could not be rendered. Retry the request; if it keeps failing, share the
          reference below with support.
        </p>
        {reference ? (
          <span className="awap-correlation" data-testid="error-reference">
            Reference: {reference}
          </span>
        ) : null}
      </div>
      <div>
        <button type="button" className="awap-button awap-button-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}

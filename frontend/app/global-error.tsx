"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary for an error thrown while rendering the root layout.
 * It must provide its own `<html>` and `<body>`.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global-error", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main id="main-content" className="awap-main">
          <div className="awap-page">
            <h1 className="awap-page-title">AWAP is unavailable</h1>
            <div role="alert" className="awap-error">
              <p>The application could not start. Please retry in a moment.</p>
              {error.digest ? (
                <span className="awap-correlation" data-testid="error-reference">
                  Reference: {error.digest}
                </span>
              ) : null}
            </div>
            <div>
              <button type="button" className="awap-button awap-button-primary" onClick={reset}>
                Try again
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

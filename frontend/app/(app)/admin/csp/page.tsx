"use client";

import { ErrorState, LoadingState } from "../../../../components/ui/QueryState";
import { formatUtcDateTime } from "../../../../lib/format";
import { useCspReports } from "../../../../lib/hooks/useCspReports";

/**
 * CSP violation dashboard (UI/UX phase 0). It shows the redacted aggregate the
 * browser reports to `/api/csp-report`: totals, directives, routes and the most
 * recent unique violations.
 */
export default function CspReportsPage() {
  const reports = useCspReports();

  if (reports.isLoading) {
    return <LoadingState label="Loading CSP reports…" />;
  }
  if (reports.isError) {
    return <ErrorState error={reports.error} message="Failed to load CSP reports." />;
  }

  const summary = reports.data;
  if (!summary) {
    return <ErrorState message="Failed to load CSP reports." />;
  }

  return (
    <div className="awap-page">
      <h1 className="awap-page-title">CSP reports</h1>
      <p className="awap-reading awap-muted">
        Redacted Content Security Policy violations. Reports are deduplicated for{" "}
        {Math.round(summary.dedupeWindowMs / 1000)} seconds and retained for 24 hours.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="awap-card" aria-labelledby="csp-total-heading">
          <h2 id="csp-total-heading" className="awap-section-title">
            Total violations
          </h2>
          <p className="text-3xl font-bold" data-testid="csp-total">
            {summary.total}
          </p>
        </section>
        <section className="awap-card" aria-labelledby="csp-unique-heading">
          <h2 id="csp-unique-heading" className="awap-section-title">
            Unique violations
          </h2>
          <p className="text-3xl font-bold" data-testid="csp-unique">
            {summary.unique}
          </p>
        </section>
        <section className="awap-card" aria-labelledby="csp-last-heading">
          <h2 id="csp-last-heading" className="awap-section-title">
            Last seen
          </h2>
          <p data-testid="csp-last-seen">{formatUtcDateTime(summary.lastSeen)}</p>
        </section>
      </div>

      {summary.total === 0 ? (
        <p className="awap-empty" data-testid="csp-empty">
          No CSP violations have been reported. The policy is clean for this window.
        </p>
      ) : (
        <>
          <section className="awap-card" aria-labelledby="csp-directive-heading">
            <h2 id="csp-directive-heading" className="awap-section-title">
              By directive
            </h2>
            <table className="awap-table">
              <thead>
                <tr>
                  <th scope="col">Directive</th>
                  <th scope="col">Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byDirective).map(([directive, count]) => (
                  <tr key={directive}>
                    <td>{directive}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="awap-card" aria-labelledby="csp-route-heading">
            <h2 id="csp-route-heading" className="awap-section-title">
              By route
            </h2>
            <table className="awap-table">
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col">Count</th>
                </tr>
              </thead>
              <tbody>
                {summary.byRoute.map((row) => (
                  <tr key={row.route}>
                    <td className="font-mono text-xs">{row.route}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="awap-card" aria-labelledby="csp-recent-heading">
            <h2 id="csp-recent-heading" className="awap-section-title">
              Recent unique violations
            </h2>
            <ul className="awap-list" aria-label="Recent CSP violations">
              {summary.recent.map((violation) => (
                <li
                  key={`${violation.directive}-${violation.blockedUri}-${violation.route}`}
                  className="awap-list-row"
                >
                  <span>
                    <strong>{violation.directive}</strong>{" "}
                    <span className="awap-muted">{violation.blockedUri}</span>
                  </span>
                  <span className="awap-muted">
                    {violation.route} · {violation.count} ·{" "}
                    {formatUtcDateTime(violation.lastSeen)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

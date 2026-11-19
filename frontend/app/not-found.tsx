import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="awap-main">
      <div className="awap-page">
        <h1 className="awap-page-title">Page not found</h1>
        <p className="awap-muted">The page you requested does not exist or you no longer have access.</p>
        <p>
          <Link href="/dashboard">Go to the dashboard</Link>
        </p>
      </div>
    </main>
  );
}

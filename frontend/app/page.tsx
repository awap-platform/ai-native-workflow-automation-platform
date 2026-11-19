import { Suspense } from "react";
import AuthShell from "../components/layout/AuthShell";
import LoginCard from "../components/auth/LoginCard";

function LoginFallback() {
  return (
    <div className="awap-card mx-auto w-full max-w-md" role="status" aria-live="polite">
      <span className="sr-only">Loading sign-in…</span>
      <span aria-hidden="true" className="awap-skeleton awap-skeleton-title block" />
      <span aria-hidden="true" className="awap-skeleton awap-skeleton-line block" />
      <span aria-hidden="true" className="awap-skeleton awap-skeleton-line block" />
    </div>
  );
}

export default function Home() {
  return (
    <AuthShell>
      <Suspense fallback={<LoginFallback />}>
        <LoginCard />
      </Suspense>
    </AuthShell>
  );
}

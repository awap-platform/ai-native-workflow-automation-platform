import { Suspense } from "react";
import AuthShell from "../../../components/layout/AuthShell";
import InvitationAcceptCard from "../../../components/auth/InvitationAcceptCard";

export default function InvitationAcceptPage() {
  return (
    <AuthShell>
      <Suspense
        fallback={
          <div className="awap-card mx-auto w-full max-w-lg" role="status" aria-live="polite">
            <span className="sr-only">Loading invitation…</span>
            <span aria-hidden="true" className="awap-skeleton awap-skeleton-title block" />
            <span aria-hidden="true" className="awap-skeleton awap-skeleton-line block" />
          </div>
        }
      >
        <InvitationAcceptCard />
      </Suspense>
    </AuthShell>
  );
}

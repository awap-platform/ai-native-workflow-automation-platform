"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setActiveTenant } from "../../lib/auth";
import { useTenantMemberships } from "../../lib/hooks/resources";
import { isForbiddenError } from "../../lib/queryClient";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/QueryState";

export default function SelectTenantPage() {
  const router = useRouter();
  const memberships = useTenantMemberships();
  const tenants = memberships.data;
  const rows = tenants ?? [];

  // A user who belongs to exactly one tenant never sees the picker.
  useEffect(() => {
    const single = tenants?.[0];
    if (tenants && tenants.length === 1 && single) {
      setActiveTenant(single.tenantId);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears cross-tenant caches
      window.location.assign("/dashboard");
    }
  }, [tenants]);

  // A failed lookup means the session is gone; the login page can refresh it. A 403 keeps the
  // forbidden state visible instead of bouncing the user.
  useEffect(() => {
    if (memberships.isError && !isForbiddenError(memberships.error)) {
      router.replace("/");
    }
  }, [memberships.isError, memberships.error, router]);

  const choose = (tenantId: string) => {
    setActiveTenant(tenantId);
    // Full reload clears all client-side caches, preventing stale cross-tenant data.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
    window.location.assign("/dashboard");
  };

  return (
    <main id="main-content" className="awap-main">
      <div className="awap-page">
        <h1 className="awap-page-title">Select tenant</h1>
        <p className="awap-muted">
          Tenant scope is visible everywhere. Choose the workspace you want to work in.
        </p>
        {memberships.isLoading ? <LoadingState label="Loading tenants..." /> : null}
        {memberships.isError ? (
          <ErrorState error={memberships.error} message="Failed to load tenants." />
        ) : null}
        {memberships.isSuccess && rows.length === 0 ? (
          <EmptyState message="You do not belong to any tenant yet." />
        ) : null}
        <div className="awap-form max-w-sm">
          {rows.map((tenant) => (
            <button
              key={tenant.tenantId}
              type="button"
              className="awap-button"
              onClick={() => choose(tenant.tenantId)}
            >
              {tenant.tenantId} — {tenant.role}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

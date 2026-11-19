"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AuthShell from "../../components/layout/AuthShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/QueryState";
import { setActiveTenant } from "../../lib/auth";
import { useTenantMemberships } from "../../lib/hooks/resources";
import { useI18n } from "../../lib/locale";
import { isForbiddenError } from "../../lib/queryClient";

export default function SelectTenantPage() {
  const router = useRouter();
  const { t } = useI18n();
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
    <AuthShell wide>
      <div className="awap-page awap-reading">
        <h1 className="awap-page-title">{t("selectTenant.title")}</h1>
        <p className="awap-muted">{t("selectTenant.description")}</p>
        {memberships.isLoading ? <LoadingState label={t("selectTenant.loading")} /> : null}
        {memberships.isError ? (
          <ErrorState error={memberships.error} message={t("selectTenant.error")} />
        ) : null}
        {memberships.isSuccess && rows.length === 0 ? (
          <EmptyState message={t("selectTenant.empty")} />
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
    </AuthShell>
  );
}

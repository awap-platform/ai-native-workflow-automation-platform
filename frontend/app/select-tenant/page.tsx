"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AuthShell from "../../components/layout/AuthShell";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/QueryState";
import { Button } from "../../components/ui/button";
import { Avatar, Badge } from "../../components/ui/surface";
import { logout, setActiveTenant } from "../../lib/auth";
import { useTenantMemberships } from "../../lib/hooks/resources";
import { useI18n } from "../../lib/locale";
import { errorStatus } from "../../lib/api";
import { safeReturnTo } from "../../lib/redirect";

export default function SelectTenantPage() {
  const router = useRouter();
  const { t } = useI18n();
  const memberships = useTenantMemberships();
  const tenants = memberships.data;
  const rows = tenants ?? [];

  const destination = () => {
    if (typeof window === "undefined") {
      return "/dashboard";
    }
    return safeReturnTo(
      new URLSearchParams(window.location.search).get("returnTo"),
      "/dashboard",
    );
  };

  // A user who belongs to exactly one tenant never sees the picker.
  useEffect(() => {
    const single = tenants?.[0];
    if (tenants && tenants.length === 1 && single) {
      setActiveTenant(single.tenantId);
      // Full reload clears all client-side caches, preventing stale cross-tenant data.
      window.location.replace(destination());
    }
  }, [tenants]);

  // Only an unauthenticated lookup bounces to login. A 403 keeps the forbidden
  // state visible, and a 5xx renders the retryable ErrorState instead of a loop.
  useEffect(() => {
    if (memberships.isError && errorStatus(memberships.error) === 401) {
      router.replace("/");
    }
  }, [memberships.isError, memberships.error, router]);

  const choose = (tenantId: string) => {
    setActiveTenant(tenantId);
    // Full reload clears all client-side caches, preventing stale cross-tenant data.
    // `replace` keeps the tenant picker out of the back stack (U2-09).
    window.location.replace(destination());
  };

  return (
    <AuthShell wide>
      <div className="awap-page mx-auto max-w-2xl">
        <h1 className="awap-page-title">{t("selectTenant.title")}</h1>
        <p className="awap-muted">
          {rows.length > 1 ? t("selectTenant.multipleDescription") : t("selectTenant.description")}
        </p>

        {memberships.isLoading ? <LoadingState label={t("selectTenant.loading")} /> : null}
        {memberships.isError ? (
          <ErrorState
            error={memberships.error}
            message={t("selectTenant.error")}
            onRetry={() => void memberships.refetch()}
            retryLabel={t("state.retry")}
          />
        ) : null}
        {memberships.isSuccess && rows.length === 0 ? (
          <EmptyState
            testId="tenant-empty-state"
            message={t("selectTenant.emptyDescription")}
            action={
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Link href="/register" className="awap-button awap-button-primary">
                  {t("selectTenant.createTenant")}
                </Link>
                <button type="button" className="awap-button" onClick={() => void logout()}>
                  {t("selectTenant.signOut")}
                </button>
              </div>
            }
          />
        ) : null}

        {rows.length > 0 ? (
          <ul className="awap-list" aria-label={t("selectTenant.listLabel")}>
            {rows.map((tenant) => (
              <li
                key={tenant.tenantId}
                className="awap-list-row"
                data-testid={`tenant-card-${tenant.tenantId}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={tenant.tenantId} size="md" />
                  <div className="min-w-0">
                    <p
                      className="awap-truncate font-semibold"
                      title={tenant.tenantId}
                    >
                      {tenant.tenantId}
                    </p>
                    <Badge variant="muted">{tenant.role}</Badge>
                  </div>
                </div>
                <Button type="button" onClick={() => choose(tenant.tenantId)}>
                  {t("selectTenant.continue")}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-xs awap-muted">{t("selectTenant.adminCta")}</p>
      </div>
    </AuthShell>
  );
}

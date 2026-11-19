"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NavGroup } from "../../lib/navigation";
import { logout } from "../../lib/auth";
import { useI18n } from "../../lib/locale";
import SidebarNav from "./SidebarNav";

export default function Sidebar({
  groups,
  pathname,
  tenant,
  role,
}: {
  groups: NavGroup[];
  pathname: string;
  tenant: string | null;
  role: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <aside className="awap-sidebar" aria-label={t("shell.sidebarLabel")} data-testid="sidebar">
      <Link href="/dashboard" className="awap-brand awap-nav-link">
        AWAP
      </Link>
      <SidebarNav groups={groups} pathname={pathname} />
      <div className="awap-form">
        <button
          type="button"
          className="awap-button justify-start"
          onClick={() => router.push("/select-tenant")}
        >
          <span className="awap-truncate" title={tenant ?? undefined}>
            {t("shell.tenant", { tenant: tenant ?? t("shell.selectTenant") })}
          </span>
        </button>
        <p className="text-xs awap-muted" data-testid="sidebar-role">
          {t("shell.role", { role: role ?? t("shell.roleUnknown") })}
        </p>
        <button type="button" className="awap-button" onClick={() => void logout()}>
          {t("shell.logout")}
        </button>
      </div>
    </aside>
  );
}

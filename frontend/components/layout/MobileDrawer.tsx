"use client";

import { useRouter } from "next/navigation";
import type { NavGroup } from "../../lib/navigation";
import { logout } from "../../lib/auth";
import { useI18n } from "../../lib/locale";
import { Drawer } from "../ui/overlays";
import SidebarNav from "./SidebarNav";

export default function MobileDrawer({
  open,
  onOpenChange,
  groups,
  pathname,
  tenant,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: NavGroup[];
  pathname: string;
  tenant: string | null;
  role: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("shell.mobileMenu")}
      side="left"
      testId="mobile-drawer"
    >
      <SidebarNav groups={groups} pathname={pathname} onNavigate={() => onOpenChange(false)} />
      <div className="awap-form">
        <button
          type="button"
          className="awap-button justify-start"
          onClick={() => {
            onOpenChange(false);
            router.push("/select-tenant");
          }}
        >
          <span className="awap-truncate" title={tenant ?? undefined}>
            {t("shell.tenant", { tenant: tenant ?? t("shell.selectTenant") })}
          </span>
        </button>
        <p className="text-xs awap-muted">
          {t("shell.role", { role: role ?? t("shell.roleUnknown") })}
        </p>
        <button
          type="button"
          className="awap-button"
          onClick={() => {
            onOpenChange(false);
            void logout();
          }}
        >
          {t("shell.logout")}
        </button>
      </div>
    </Drawer>
  );
}

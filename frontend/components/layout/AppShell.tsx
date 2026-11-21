"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useActiveRole } from "../../lib/hooks/useActiveRole";
import { useActiveTenant } from "../../lib/hooks/useActiveTenant";
import { useUnreadBadge } from "../../lib/hooks/useUnreadBadge";
import { useI18n } from "../../lib/locale";
import { breadcrumbForPath, requiredRolesForPath, visibleNavGroups } from "../../lib/navigation";
import { ForbiddenState } from "../ui/states";
import type { BreadcrumbItem } from "../ui/data-display";
import GlobalCommandPalette from "./GlobalCommandPalette";
import InAppTour from "./InAppTour";
import MobileDrawer from "./MobileDrawer";
import SessionTimeoutWarning from "./SessionTimeoutWarning";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/**
 * Application shell: grouped sidebar, sticky topbar with global search, tenant
 * and role identity, breadcrumb, mobile drawer and ⌘K command palette.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const role = useActiveRole();
  const tenant = useActiveTenant();
  const unread = useUnreadBadge(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups = visibleNavGroups(role);
  const requiredRoles = requiredRolesForPath(pathname);
  const forbidden = role !== null && requiredRoles !== undefined && !requiredRoles.includes(role);

  const breadcrumbItems: BreadcrumbItem[] = breadcrumbForPath(pathname).map((entry) => ({
    label: entry.labelKey.includes(".") ? t(entry.labelKey) : entry.labelKey,
    ...(entry.href ? { href: entry.href } : {}),
  }));

  return (
    <div className="awap-shell">
      <Sidebar groups={groups} pathname={pathname} tenant={tenant} role={role} />
      <div className="awap-shell-main">
        <SessionTimeoutWarning />
        <Topbar
          onOpenMenu={() => setMobileOpen(true)}
          onOpenSearch={() => setPaletteOpen(true)}
          breadcrumbItems={breadcrumbItems}
          tenant={tenant}
          role={role}
          unread={unread}
        />
        <main id="main-content" className="awap-main" tabIndex={-1}>
          {forbidden ? <ForbiddenState message={t("state.forbidden")} /> : children}
          {forbidden || pathname !== "/dashboard" ? null : <InAppTour />}
        </main>
      </div>
      <MobileDrawer
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        groups={groups}
        pathname={pathname}
        tenant={tenant}
        role={role}
      />
      {paletteOpen ? (
        <GlobalCommandPalette open onClose={() => setPaletteOpen(false)} role={role} />
      ) : null}
    </div>
  );
}

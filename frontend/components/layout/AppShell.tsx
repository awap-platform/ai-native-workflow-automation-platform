"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { logout } from "../../lib/auth";
import { useActiveTenant } from "../../lib/hooks/useActiveTenant";
import { defaultLocale, t } from "../../lib/i18n";

interface NavItem {
  href: string;
  labelKey: string;
}

interface NavGroup {
  headingKey: string;
  items: NavItem[];
}

/**
 * Information architecture from the UI/UX programme (section 1.4). Grouping
 * keeps the growing navigation scannable and mirrors the job the user is doing
 * rather than the backend module that implements it.
 */
const navGroups: NavGroup[] = [
  {
    headingKey: "nav.myWork",
    items: [{ href: "/tasks", labelKey: "nav.inbox" }],
  },
  {
    headingKey: "nav.design",
    items: [
      { href: "/workflows", labelKey: "nav.workflows" },
      { href: "/workflows/designer", labelKey: "nav.designer" },
      { href: "/forms/builder", labelKey: "nav.formBuilder" },
      { href: "/forms/fill", labelKey: "nav.fillForm" },
    ],
  },
  {
    headingKey: "nav.operate",
    items: [
      { href: "/instances", labelKey: "nav.instances" },
      { href: "/documents", labelKey: "nav.documents" },
      { href: "/analytics", labelKey: "nav.analytics" },
      { href: "/notifications", labelKey: "nav.notifications" },
      { href: "/notification-templates", labelKey: "nav.templates" },
      { href: "/organizations", labelKey: "nav.organization" },
    ],
  },
  {
    headingKey: "nav.ai",
    items: [{ href: "/copilot", labelKey: "nav.copilot" }],
  },
  {
    headingKey: "nav.admin",
    items: [{ href: "/admin/csp", labelKey: "nav.cspReports" }],
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const tenant = useActiveTenant();

  return (
    <div className="awap-shell">
      <aside className="awap-sidebar" aria-label="Primary navigation">
        <Link href="/dashboard" className="awap-brand awap-nav-link">
          AWAP
        </Link>
        <nav className="awap-nav">
          {navGroups.map((group) => (
            <div key={group.headingKey} className="awap-nav-group">
              <h2 className="awap-nav-heading">{t(defaultLocale, group.headingKey)}</h2>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="awap-nav-link"
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                >
                  {t(defaultLocale, item.labelKey)}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="awap-form">
          <button
            type="button"
            className="awap-button"
            onClick={() => router.push("/select-tenant")}
          >
            {t(defaultLocale, "shell.tenant", {
              tenant: tenant ?? t(defaultLocale, "shell.selectTenant"),
            })}
          </button>
          <button type="button" className="awap-button" onClick={() => void logout()}>
            {t(defaultLocale, "shell.logout")}
          </button>
        </div>
      </aside>
      <main id="main-content" className="awap-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

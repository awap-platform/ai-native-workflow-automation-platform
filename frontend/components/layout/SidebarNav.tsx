"use client";

import Link from "next/link";
import { isNavActive, type NavGroup } from "../../lib/navigation";
import { useI18n } from "../../lib/locale";
import NavIconView from "./NavIcon";

export interface SidebarNavProps {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}

/** Grouped navigation links shared by the desktop sidebar and mobile drawer. */
export default function SidebarNav({ groups, pathname, onNavigate }: SidebarNavProps) {
  const { t } = useI18n();

  return (
    <nav className="awap-nav" aria-label={t("shell.sidebarLabel")}>
      {groups.map((group) => (
        <div key={group.headingKey} className="awap-nav-group">
          <h2 className="awap-nav-heading">{t(group.headingKey)}</h2>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="awap-nav-link flex items-center gap-2"
              aria-current={isNavActive(pathname, item.href) ? "page" : undefined}
              {...(onNavigate ? { onClick: onNavigate } : {})}
            >
              <NavIconView icon={item.icon} />
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

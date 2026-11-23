"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Bot, Menu, Search } from "lucide-react";
import { logout } from "../../lib/auth";
import { useI18n } from "../../lib/locale";
import { Breadcrumb, type BreadcrumbItem } from "../ui/data-display";
import { IconButton } from "../ui/icon-button";
import { Menu as UserMenu } from "../ui/overlays";
import { Avatar } from "../ui/surface";
import LocaleSwitcher from "./LocaleSwitcher";
import ThemeToggle from "./ThemeToggle";

export default function Topbar({
  onOpenMenu,
  onOpenSearch,
  breadcrumbItems,
  tenant,
  role,
  unread,
}: {
  onOpenMenu: () => void;
  onOpenSearch: () => void;
  breadcrumbItems: BreadcrumbItem[];
  tenant: string | null;
  role: string | null;
  unread: number;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const displayName = tenant ?? t("shell.selectTenant");

  return (
    <header className="awap-topbar" data-testid="topbar">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          label={t("shell.openMenu")}
          onClick={onOpenMenu}
          className="md:hidden"
          data-testid="open-mobile-menu"
        >
          <Menu className="size-5" aria-hidden="true" />
        </IconButton>
        <Link href="/dashboard" className="awap-brand md:hidden">
          AWAP
        </Link>
        <div className="hidden min-w-0 sm:block">
          <Breadcrumb items={breadcrumbItems} />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="awap-topbar-search"
          onClick={onOpenSearch}
          aria-keyshortcuts="Control+K Meta+K"
          aria-label={t("shell.searchShortcut")}
          data-testid="open-command-palette"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="hidden lg:inline">{t("shell.searchPlaceholder")}</span>
          <kbd className="awap-kbd hidden lg:inline">Ctrl K</kbd>
        </button>

        <div className="hidden sm:block">
          <Link
            href="/copilot"
            className="awap-button awap-button-ghost"
            aria-label={t("shell.aiAssistant")}
          >
            <Bot className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <Link
          href="/notifications"
          className="awap-button awap-button-ghost relative"
          aria-label={t("shell.notifications")}
        >
          <Bell className="size-4" aria-hidden="true" />
          {unread > 0 ? (
            <span
              className="awap-badge awap-badge-active absolute -right-1 -top-1 min-w-5 px-1 text-[0.65rem]"
              aria-label={t("shell.unreadCount", { count: unread })}
              data-testid="topbar-unread"
            >
              {unread}
            </span>
          ) : null}
        </Link>

        <ThemeToggle />
        <div className="hidden sm:block">
          <LocaleSwitcher />
        </div>

        <div className="ml-1 hidden min-w-0 flex-col md:flex" data-testid="topbar-identity">
          <span className="awap-truncate max-w-48 text-sm font-semibold" title={displayName}>
            {t("shell.tenant", { tenant: displayName })}
          </span>
          {tenant && !role ? (
            <span className="text-xs awap-muted" data-testid="topbar-role-unavailable">
              {t("shell.roleUnavailable")}
            </span>
          ) : (
            <span className="text-xs awap-muted">
              {t("shell.role", { role: role ?? t("shell.roleUnknown") })}
            </span>
          )}
        </div>

        <UserMenu
          label={t("shell.menuLabel")}
          trigger={
            <span className="flex items-center gap-2">
              <Avatar name={displayName} size="sm" />
              <span className="hidden max-w-32 awap-truncate xl:inline">{displayName}</span>
            </span>
          }
          items={[
            {
              label: t("shell.selectTenant"),
              onSelect: () => router.push("/select-tenant"),
            },
            { label: t("shell.logout"), onSelect: () => void logout(), danger: true },
          ]}
        />
      </div>
    </header>
  );
}

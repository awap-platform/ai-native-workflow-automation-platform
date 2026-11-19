"use client";

import { useRouter } from "next/navigation";
import { logout } from "../../lib/auth";
import { useI18n } from "../../lib/locale";
import { visibleNavGroups } from "../../lib/navigation";
import { useTheme } from "../../lib/theme";
import { CommandPalette, type CommandItem } from "../ui/overlays";

/**
 * Global command palette. Navigation destinations and a small action set share
 * the same catalog as the sidebar, so the palette can never drift from the IA.
 */
export default function GlobalCommandPalette({
  open,
  onClose,
  role,
}: {
  open: boolean;
  onClose: () => void;
  role: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const { toggleTheme } = useTheme();

  const items: CommandItem[] = visibleNavGroups(role).flatMap((group) =>
    group.items.map((item) => ({
      id: `nav-${item.href}`,
      label: t(item.labelKey),
      group: t(group.headingKey),
      keywords: [...(item.keywords ?? []), group.headingKey],
      onSelect: () => router.push(item.href),
    })),
  );

  items.push(
    {
      id: "action-toggle-theme",
      label: t("shell.commandActionToggleTheme"),
      group: t("shell.commandGroupActions"),
      keywords: ["dark", "light", "theme"],
      onSelect: toggleTheme,
    },
    {
      id: "action-open-notifications",
      label: t("shell.commandActionOpenNotifications"),
      group: t("shell.commandGroupActions"),
      keywords: ["alerts", "inbox"],
      onSelect: () => router.push("/notifications"),
    },
    {
      id: "action-open-inbox",
      label: t("shell.commandActionOpenInbox"),
      group: t("shell.commandGroupActions"),
      keywords: ["tasks", "approvals"],
      onSelect: () => router.push("/tasks"),
    },
    {
      id: "action-open-copilot",
      label: t("shell.commandActionOpenCopilot"),
      group: t("shell.commandGroupActions"),
      keywords: ["ai", "assistant"],
      onSelect: () => router.push("/copilot"),
    },
    {
      id: "action-logout",
      label: t("shell.commandActionLogout"),
      group: t("shell.commandGroupActions"),
      keywords: ["sign out"],
      onSelect: () => void logout(),
    },
  );

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      items={items}
      title={t("shell.commandTitle")}
      placeholder={t("shell.commandPlaceholder")}
      emptyLabel={t("shell.commandEmpty")}
    />
  );
}

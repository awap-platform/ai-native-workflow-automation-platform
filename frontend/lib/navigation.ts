/**
 * Single navigation model shared by the sidebar, command palette, breadcrumbs,
 * route guards and E2E tests. Adding a destination in one place is enough for
 * every surface to stay consistent (risk R1-01).
 */
export interface NavItem {
  href: string;
  labelKey: string;
  icon: NavIcon;
  keywords?: string[];
  /** When set, only these roles see the item; unknown roles see everything. */
  requiredRoles?: string[];
}

export interface NavGroup {
  headingKey: string;
  items: NavItem[];
}

export type NavIcon =
  | "inbox"
  | "workflow"
  | "designer"
  | "form"
  | "instances"
  | "document"
  | "analytics"
  | "bell"
  | "template"
  | "organization"
  | "copilot"
  | "shield"
  | "palette";

const ADMIN_ROLES = ["TENANT_ADMIN", "ADMIN", "SYS_ADMIN"];

export const NAV_GROUPS: NavGroup[] = [
  {
    headingKey: "nav.myWork",
    items: [
      { href: "/tasks", labelKey: "nav.inbox", icon: "inbox", keywords: ["tasks", "approvals"] },
    ],
  },
  {
    headingKey: "nav.design",
    items: [
      {
        href: "/workflows",
        labelKey: "nav.workflows",
        icon: "workflow",
        keywords: ["process", "definitions"],
      },
      {
        href: "/workflows/designer",
        labelKey: "nav.designer",
        icon: "designer",
        keywords: ["bpmn", "canvas", "nodes"],
      },
      {
        href: "/forms/builder",
        labelKey: "nav.formBuilder",
        icon: "form",
        keywords: ["schema", "fields"],
      },
      {
        href: "/forms/fill",
        labelKey: "nav.fillForm",
        icon: "form",
        keywords: ["submit", "request"],
      },
    ],
  },
  {
    headingKey: "nav.operate",
    items: [
      {
        href: "/instances",
        labelKey: "nav.instances",
        icon: "instances",
        keywords: ["monitor", "running"],
      },
      {
        href: "/documents",
        labelKey: "nav.documents",
        icon: "document",
        keywords: ["files", "scan"],
      },
      {
        href: "/analytics",
        labelKey: "nav.analytics",
        icon: "analytics",
        keywords: ["metrics", "bottlenecks"],
      },
      {
        href: "/notifications",
        labelKey: "nav.notifications",
        icon: "bell",
        keywords: ["inbox", "alerts"],
      },
      {
        href: "/notification-templates",
        labelKey: "nav.templates",
        icon: "template",
        keywords: ["messages", "email"],
      },
      {
        href: "/organizations",
        labelKey: "nav.organization",
        icon: "organization",
        keywords: ["departments", "teams"],
      },
    ],
  },
  {
    headingKey: "nav.ai",
    items: [
      {
        href: "/copilot",
        labelKey: "nav.copilot",
        icon: "copilot",
        keywords: ["assistant", "ai", "agent"],
      },
    ],
  },
  {
    headingKey: "nav.admin",
    items: [
      {
        href: "/admin",
        labelKey: "nav.identityConsole",
        icon: "organization",
        keywords: ["users", "groups", "roles", "permissions", "invitations", "quota"],
        requiredRoles: ADMIN_ROLES,
      },
      {
        href: "/admin/operate",
        labelKey: "nav.operateConsole",
        icon: "instances",
        keywords: ["health", "outbox", "dlq", "jobs", "operations"],
        requiredRoles: ADMIN_ROLES,
      },
      {
        href: "/admin/audit",
        labelKey: "nav.auditLog",
        icon: "shield",
        keywords: ["audit", "break-glass", "export"],
        requiredRoles: ADMIN_ROLES,
      },
      {
        href: "/admin/csp",
        labelKey: "nav.cspReports",
        icon: "shield",
        keywords: ["security", "violations"],
        requiredRoles: ADMIN_ROLES,
      },
      {
        href: "/design-system",
        labelKey: "nav.designSystem",
        icon: "palette",
        keywords: ["components", "catalog", "theme"],
        requiredRoles: ADMIN_ROLES,
      },
    ],
  },
];

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function flattenNavItems(): NavItem[] {
  return NAV_GROUPS.flatMap((group) => group.items);
}

/** Filters admin-only destinations. An unknown role keeps the legacy full menu. */
export function visibleNavGroups(role: string | null | undefined): NavGroup[] {
  if (!role) {
    return NAV_GROUPS;
  }
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.requiredRoles || item.requiredRoles.includes(role),
    ),
  })).filter((group) => group.items.length > 0);
}

export function requiredRolesForPath(pathname: string): string[] | undefined {
  return navItemForPath(pathname)?.requiredRoles;
}

/** Longest matching href wins, so `/workflows/designer` is not shadowed by `/workflows`. */
export function navItemForPath(pathname: string): NavItem | undefined {
  return flattenNavItems()
    .filter((item) => isNavActive(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export interface BreadcrumbEntry {
  labelKey: string;
  href?: string;
}

/** Builds a breadcrumb from the matched navigation item and the remaining path. */
export function breadcrumbForPath(pathname: string): BreadcrumbEntry[] {
  const entry: BreadcrumbEntry[] = [{ labelKey: "breadcrumb.home", href: "/dashboard" }];
  const match = navItemForPath(pathname);
  if (!match) {
    if (pathname !== "/dashboard") {
      entry.push({ labelKey: "breadcrumb.current" });
    }
    return entry;
  }
  if (match.href !== "/dashboard") {
    entry.push({ labelKey: match.labelKey, href: match.href });
  }
  const rest = pathname.slice(match.href.length).split("/").filter(Boolean);
  for (const segment of rest) {
    entry.push({ labelKey: segment.replace(/-/g, " ") });
  }
  return entry;
}

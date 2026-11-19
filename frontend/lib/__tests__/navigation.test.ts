import {
  breadcrumbForPath,
  flattenNavItems,
  navItemForPath,
  requiredRolesForPath,
  visibleNavGroups,
} from "../navigation";

describe("navigation model", () => {
  it("uses the longest matching href for nested routes", () => {
    expect(navItemForPath("/workflows/designer")?.href).toBe("/workflows/designer");
    expect(navItemForPath("/workflows")?.href).toBe("/workflows");
    expect(navItemForPath("/admin/csp")?.href).toBe("/admin/csp");
  });

  it("hides admin destinations from a non-admin role", () => {
    const employeeHrefs = visibleNavGroups("EMPLOYEE").flatMap((group) =>
      group.items.map((item) => item.href),
    );
    expect(employeeHrefs).not.toContain("/admin/csp");
    expect(employeeHrefs).not.toContain("/design-system");
    expect(employeeHrefs).toContain("/tasks");

    const adminHrefs = visibleNavGroups("TENANT_ADMIN").flatMap((group) =>
      group.items.map((item) => item.href),
    );
    expect(adminHrefs).toContain("/admin/csp");
    expect(adminHrefs).toContain("/design-system");
  });

  it("keeps the full menu for an unknown role", () => {
    expect(visibleNavGroups(null).flatMap((group) => group.items)).toHaveLength(
      flattenNavItems().length,
    );
  });

  it("resolves required roles and breadcrumbs", () => {
    expect(requiredRolesForPath("/admin/csp")).toContain("TENANT_ADMIN");
    expect(requiredRolesForPath("/tasks")).toBeUndefined();
    expect(breadcrumbForPath("/admin/csp").map((entry) => entry.labelKey)).toEqual([
      "breadcrumb.home",
      "nav.cspReports",
    ]);
    expect(breadcrumbForPath("/workflows/designer").map((entry) => entry.labelKey)).toEqual([
      "breadcrumb.home",
      "nav.designer",
    ]);
  });
});

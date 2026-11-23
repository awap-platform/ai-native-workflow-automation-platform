import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  formatDateTimeForLocale,
  formatNumberForLocale,
  isLocale,
  plural,
  resolveLocale,
  t,
  tPlural,
} from "../i18n";

describe("i18n", () => {
  it("translates and interpolates in both catalogs", () => {
    expect(t("en", "nav.myWork")).toBe("My Work");
    expect(t("tr", "nav.myWork")).toBe("İşlerim");
    expect(t("en", "shell.tenant", { tenant: "acme" })).toBe("Tenant: acme");
  });

  it("falls back to the default locale and then to the key", () => {
    expect(t("tr", "missing.key")).toBe("missing.key");
    expect(t("en", "state.retry", { unused: "x" })).toBe("Retry");
  });

  it("resolves locales and rejects unsupported tags", () => {
    expect(resolveLocale("tr-TR")).toBe("tr");
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("de-DE")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(isLocale("tr")).toBe(true);
    expect(isLocale("de")).toBe(false);
  });

  it("selects CLDR plural forms", () => {
    const forms = { one: "{count} task", other: "{count} tasks" };
    expect(plural("en", 1, forms)).toBe("1 task");
    expect(plural("en", 2, forms)).toBe("2 tasks");
    expect(plural("tr", 2, forms)).toBe("2 tasks");
  });

  it("formats numbers and dates with an explicit locale and UTC", () => {
    expect(formatNumberForLocale("en", 1234567)).toBe("1,234,567");
    expect(formatDateTimeForLocale("en", "2026-11-09T10:00:00.000Z")).toContain("2026");
    expect(formatDateTimeForLocale("en", "not-a-date")).toBe("—");
  });

  it("selects count copy for 0, 1, 2 and large numbers in English", () => {
    expect(tPlural("en", "tasks.list.count", 0)).toBe("0 results");
    expect(tPlural("en", "tasks.list.count", 1)).toBe("1 result");
    expect(tPlural("en", "tasks.list.count", 2)).toBe("2 results");
    expect(tPlural("en", "tasks.list.count", 1000)).toBe("1,000 results");
    expect(tPlural("en", "tasks.subtitle", 1)).toBe("1 work item in this tenant");
    expect(tPlural("en", "tasks.count", 1)).toBe("1 pending task");
    expect(tPlural("en", "tasks.count", 2)).toBe("2 pending tasks");
  });

  it("uses Turkish grammar and Turkish number grouping", () => {
    // Turkish does not add a plural suffix after a numeral, so one and other share a form.
    expect(tPlural("tr", "tasks.list.count", 0)).toBe("0 sonuç");
    expect(tPlural("tr", "tasks.list.count", 1)).toBe("1 sonuç");
    expect(tPlural("tr", "tasks.list.count", 2)).toBe("2 sonuç");
    expect(tPlural("tr", "tasks.list.count", 1000)).toBe("1.000 sonuç");
    expect(tPlural("tr", "tasks.subtitle", 1)).toBe("Bu kiracıda 1 iş öğesi");
  });

  it("falls back to the default locale then the other form for unknown keys", () => {
    expect(tPlural("tr", "missing.count", 1)).toBe("missing.count");
    expect(tPlural("en", "tasks.list.count", 3, { extra: "x" })).toBe("3 results");
  });
});

/**
 * Regression gate for issue #358: count copy must go through `tPlural`, never through a
 * literal "{value} results" / "{value} work items" JSX concatenation. Adding a new
 * count to these surfaces without a message key fails this test.
 */
describe("count copy", () => {
  // A JSX count expression must not be followed by a literal count noun (`{n} results`).
  // The lookahead keeps prop assignments such as `} task={selected}` from matching.
  const CONCATENATION =
    /\}\s+(?:results?|definitions?|work items?|open work items?|pending tasks?)\b(?=\s*(?:[<·.,;]|$))/;

  function sourceFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "node_modules") {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...sourceFiles(path));
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(path);
      }
    }
    return files;
  }

  it("is never built by string concatenation in task, dashboard or workflow surfaces", () => {
    const roots = ["components/tasks", "components/workflows", join("app", "(app)", "dashboard")];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (CONCATENATION.test(line)) {
              offenders.push(`${file}:${index + 1}: ${line.trim()}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});

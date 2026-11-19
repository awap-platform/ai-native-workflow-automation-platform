import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  getResolvedThemeSnapshot,
  isTheme,
  readStoredTheme,
  resolveTheme,
  setTheme,
  toggleTheme,
} from "../theme";

describe("theme store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    delete document.documentElement.dataset.theme;
  });

  it("normalizes theme values and resolves system preference", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("sepia")).toBe(false);
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("applies the resolved theme to the document", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyResolvedTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("persists the selected theme and supports toggling", () => {
    setTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
    expect(getResolvedThemeSnapshot()).toBe("dark");

    toggleTheme();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getResolvedThemeSnapshot()).toBe("light");
  });

  it("falls back to system for an unknown stored value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredTheme()).toBe("system");
  });
});

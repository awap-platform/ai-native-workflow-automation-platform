import "@testing-library/jest-dom";

// jsdom does not implement matchMedia; the theme store and ThemeToggle need it.
// The Pact suite runs in the Node environment, where there is no `window`.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

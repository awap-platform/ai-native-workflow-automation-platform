import en from "../../messages/en.json";
import tr from "../../messages/tr.json";
import { locales } from "../i18n";

describe("i18n catalog parity", () => {
  const enKeys = Object.keys(en).sort();
  const trKeys = Object.keys(tr).sort();

  it("has exactly the same keys in every locale", () => {
    expect(trKeys).toEqual(enKeys);
    for (const locale of locales) {
      const catalog = locale === "en" ? en : tr;
      expect(Object.keys(catalog).length).toBeGreaterThan(0);
    }
  });

  it("has no empty translations", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value).toBe("string");
      if (value.trim().length === 0) {
        throw new Error(`Empty translation: en.${key}`);
      }
    }
    for (const [key, value] of Object.entries(tr)) {
      expect(typeof value).toBe("string");
      if (value.trim().length === 0) {
        throw new Error(`Empty translation: tr.${key}`);
      }
    }
  });
});

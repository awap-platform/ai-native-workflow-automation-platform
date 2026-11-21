import {
  AUTOSAVE_DELAY_MS,
  clearFillValues,
  clearFormDraft,
  draftSignature,
  formDraftKey,
  loadFillValues,
  loadFormDraft,
  parseFormDraft,
  saveFillValues,
  saveFormDraft,
  type DraftStorage,
} from "../draft";

function memoryStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("form builder draft", () => {
  it("keys drafts by tenant so two tenants never share a draft", () => {
    expect(formDraftKey("tenant-a")).not.toBe(formDraftKey("tenant-b"));
    expect(formDraftKey(null)).toBe(formDraftKey(""));
  });

  it("round-trips a draft and stamps savedAt", () => {
    const storage = memoryStorage();
    const key = formDraftKey("tenant-a");
    const fields = [{ id: "name", type: "TEXT" as const, label: "Name" }];

    expect(saveFormDraft(storage, key, { name: "Intake", fields, formId: "f1", readOnly: false })).toBe(
      true,
    );
    const loaded = loadFormDraft(storage, key);
    expect(loaded?.name).toBe("Intake");
    expect(loaded?.fields).toEqual(fields);
    expect(loaded?.formId).toBe("f1");
    expect(loaded?.savedAt).toEqual(expect.any(String));
  });

  it("ignores corrupt drafts instead of crashing", () => {
    expect(parseFormDraft("{not-json")).toBeNull();
    expect(parseFormDraft('{"fields":"nope"}')).toBeNull();
    expect(parseFormDraft(null)).toBeNull();
  });

  it("clears a draft", () => {
    const storage = memoryStorage();
    const key = formDraftKey("tenant-a");
    saveFormDraft(storage, key, { name: "A", fields: [], formId: null, readOnly: false });
    clearFormDraft(storage, key);
    expect(loadFormDraft(storage, key)).toBeNull();
  });

  it("survives a storage backend that throws", () => {
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(
      saveFormDraft(broken, "k", { name: "A", fields: [], formId: null, readOnly: false }),
    ).toBe(false);
    expect(loadFormDraft(broken, "k")).toBeNull();
    expect(() => clearFormDraft(broken, "k")).not.toThrow();
  });

  it("autosaves at a short debounce", () => {
    expect(AUTOSAVE_DELAY_MS).toBeGreaterThan(0);
    expect(AUTOSAVE_DELAY_MS).toBeLessThanOrEqual(1000);
  });

  it("changes the signature when a field changes", () => {
    const before = draftSignature("A", [{ id: "name", type: "TEXT" }]);
    const after = draftSignature("A", [{ id: "name", type: "TEXT", required: true }]);
    expect(before).not.toBe(after);
  });
});

describe("fill value preservation (U6-10)", () => {
  it("round-trips answers per form", () => {
    const storage = memoryStorage();
    saveFillValues(storage, "form-1", { name: "Ada", count: "2" });
    expect(loadFillValues(storage, "form-1")).toEqual({ name: "Ada", count: "2" });
    expect(loadFillValues(storage, "form-2")).toBeNull();
  });

  it("ignores non-string values and clears values", () => {
    const storage = memoryStorage();
    storage.setItem("awap:form-fill-values:form-1", JSON.stringify({ name: "Ada", bad: 3 }));
    expect(loadFillValues(storage, "form-1")).toEqual({ name: "Ada" });
    clearFillValues(storage, "form-1");
    expect(loadFillValues(storage, "form-1")).toBeNull();
  });

  it("ignores an empty form id", () => {
    const storage = memoryStorage();
    saveFillValues(storage, "", { name: "Ada" });
    expect(storage.data.size).toBe(0);
    expect(loadFillValues(storage, "")).toBeNull();
  });
});

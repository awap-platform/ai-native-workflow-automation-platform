import {
  calculationCycle,
  computeCalculatedValues,
  describeCondition,
  isFieldVisible,
  parseFormSchema,
  schemaIssues,
  toSubmissionData,
  validateValues,
  visibleEntries,
  visibleFields,
  type FormField,
  type FormSchema,
} from "../schema";

function schema(fields: FormField[]): FormSchema {
  return { fields };
}

function messages(result: ReturnType<typeof validateValues>): string[] {
  return result.map((issue) => issue.message);
}

describe("T6-01 field type errors", () => {
  const cases: Array<[FormField, string, string]> = [
    [{ id: "email", type: "EMAIL", label: "Email" }, "not-an-email", '"Email" must be a valid email address.'],
    [{ id: "phone", type: "PHONE", label: "Phone" }, "abc", '"Phone" must be a valid phone number.'],
    [{ id: "date", type: "DATE", label: "Date" }, "2026-13-40", '"Date" must be a valid ISO date (YYYY-MM-DD).'],
    [{ id: "at", type: "DATETIME", label: "When" }, "2026-11-20", '"When" must be a valid ISO-8601 date-time.'],
    [
      { id: "tier", type: "SELECT", label: "Tier", options: ["Silver"] },
      "Gold",
      '"Tier" must be one of the allowed options.',
    ],
    [
      { id: "tags", type: "MULTI_SELECT", label: "Tags", options: ["a"] },
      JSON.stringify(["b"]),
      '"Tags" must contain only allowed options.',
    ],
    [{ id: "amount", type: "NUMBER", label: "Amount" }, "abc", '"Amount" must be a number.'],
    [{ id: "agree", type: "BOOLEAN", label: "Agree" }, "maybe", '"Agree" must be true or false.'],
  ];

  it.each(cases)("rejects %j (%s)", (field, value, expected) => {
    const issues = validateValues(schema([field]), { [field.id]: value });
    expect(messages(issues)).toContain(expected);
  });

  it("accepts valid values for every type", () => {
    const issues = validateValues(
      schema([
        { id: "email", type: "EMAIL" },
        { id: "phone", type: "PHONE" },
        { id: "date", type: "DATE" },
        { id: "at", type: "DATETIME" },
        { id: "tier", type: "SELECT", options: ["Gold"] },
        { id: "tags", type: "MULTI_SELECT", options: ["a", "b"] },
        { id: "amount", type: "NUMBER", min: 1, max: 10 },
        { id: "agree", type: "BOOLEAN" },
      ]),
      {
        email: "ada@acme.com",
        phone: "+44 20 7946 0958",
        date: "2026-11-20",
        at: "2026-11-20T10:30",
        tier: "Gold",
        tags: JSON.stringify(["a", "b"]),
        amount: "5",
        agree: "true",
      },
    );
    expect(issues).toEqual([]);
  });
});

describe("T6-02 required fields block submit", () => {
  it("treats missing, empty and whitespace-only values as empty", () => {
    const subject = schema([{ id: "name", type: "TEXT", label: "Name", required: true }]);
    expect(messages(validateValues(subject, {}))).toEqual(['"Name" is required.']);
    expect(messages(validateValues(subject, { name: "" }))).toEqual(['"Name" is required.']);
    expect(messages(validateValues(subject, { name: "   " }))).toEqual(['"Name" is required.']);
    expect(validateValues(subject, { name: "Ada" })).toEqual([]);
  });

  it("does not treat false or zero as empty", () => {
    const subject = schema([
      { id: "agree", type: "BOOLEAN", required: true },
      { id: "amount", type: "NUMBER", required: true },
    ]);
    expect(validateValues(subject, { agree: "false", amount: "0" })).toEqual([]);
  });

  it("requires at least one multi-select option", () => {
    const subject = schema([
      { id: "tags", type: "MULTI_SELECT", label: "Tags", options: ["a"], required: true },
    ]);
    expect(messages(validateValues(subject, { tags: "[]" }))).toContain('"Tags" is required.');
  });
});

describe("T6-03 regex and min/max messages", () => {
  const subject = schema([
    { id: "code", type: "TEXT", label: "Code", minLength: 3, maxLength: 5 },
    { id: "slug", type: "TEXT", label: "Slug", pattern: "^[a-z]+$" },
    { id: "amount", type: "NUMBER", label: "Amount", min: 10, max: 20 },
  ]);

  it("reports length, pattern and numeric bounds", () => {
    const issues = messages(
      validateValues(subject, { code: "ab", slug: "ABC", amount: "5" }),
    );
    expect(issues).toContain('"Code" must be at least 3 characters.');
    expect(issues).toContain('"Slug" must match the pattern ^[a-z]+$.');
    expect(issues).toContain('"Amount" must be at least 10.');

    const tooLong = messages(
      validateValues(subject, { code: "abcdef", slug: "abc", amount: "25" }),
    );
    expect(tooLong).toContain('"Code" must be at most 5 characters.');
    expect(tooLong).toContain('"Amount" must be at most 20.');
  });
});

describe("T6-04 conditional visibility", () => {
  const subject = schema([
    { id: "choice", type: "SELECT", options: ["yes", "no"] },
    {
      id: "detail",
      type: "TEXT",
      label: "Detail",
      required: true,
      visibleWhen: { fieldId: "choice", operator: "EQUALS", value: "yes" },
    },
    {
      id: "count",
      type: "NUMBER",
      visibleWhen: { fieldId: "count_source", operator: "GREATER_THAN", value: "2" },
    },
    { id: "count_source", type: "NUMBER" },
  ]);

  it("hides and shows the dependent field and skips its required rule", () => {
    expect(visibleFields(subject, { choice: "no" }).map((field) => field.id)).toEqual([
      "choice",
      "count_source",
    ]);
    expect(validateValues(subject, { choice: "no" })).toEqual([]);
    expect(visibleFields(subject, { choice: "yes" }).map((field) => field.id)).toContain("detail");
    expect(messages(validateValues(subject, { choice: "yes" }))).toEqual([
      '"Detail" is required.',
    ]);
  });

  it("supports numeric comparisons and emptiness operators", () => {
    expect(isFieldVisible(subject.fields[2] as FormField, { count_source: "3" })).toBe(true);
    expect(isFieldVisible(subject.fields[2] as FormField, { count_source: "1" })).toBe(false);
    expect(
      isFieldVisible(
        { id: "x", type: "TEXT", visibleWhen: { fieldId: "choice", operator: "IS_EMPTY" } },
        { choice: "" },
      ),
    ).toBe(true);
    expect(describeCondition({ fieldId: "choice", operator: "IS_NOT_EMPTY" })).toBe(
      "Show when choice is not empty",
    );
  });

  it("renders section and divider entries in order", () => {
    const entries = visibleEntries(
      schema([
        { id: "s1", type: "SECTION", label: "Intro" },
        { id: "n", type: "TEXT" },
        { id: "d", type: "DIVIDER" },
      ]),
      {},
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["section", "field", "divider"]);
  });
});

describe("calculations", () => {
  const subject = schema([
    { id: "units", type: "NUMBER" },
    { id: "price", type: "NUMBER" },
    { id: "total", type: "NUMBER", calculated: "units * price" },
  ]);

  it("computes a value in dependency order and rejects a tampered value", () => {
    const computed = computeCalculatedValues(subject, { units: "3", price: "2.5" });
    expect(computed.values.total).toBe("7.5");
    expect(
      messages(validateValues(subject, { units: "3", price: "2.5", total: "1" })),
    ).toContain('"total" must equal the calculated value 7.5.');
    expect(validateValues(subject, { units: "3", price: "2.5", total: "7.5" })).toEqual([]);
  });

  it("detects a cycle and blocks an invalid schema", () => {
    const cyclic = schema([
      { id: "a", type: "NUMBER", calculated: "b + 1" },
      { id: "b", type: "NUMBER", calculated: "a + 1" },
      { id: "tier", type: "SELECT", label: "Tier" },
    ]);
    expect(calculationCycle(cyclic)).toEqual(["a", "b", "a"]);
    const issues = messages(schemaIssues(cyclic));
    expect(issues.some((message) => message.startsWith("Calculated fields form a cycle"))).toBe(
      true,
    );
    expect(issues.some((message) => message.includes("needs at least one option"))).toBe(true);
  });

  it("reports unknown references and duplicate ids", () => {
    const issues = messages(
      schemaIssues(
        schema([
          { id: "a", type: "NUMBER", calculated: "missing + 1" },
          { id: "a", type: "TEXT" },
          { id: "b", type: "TEXT", visibleWhen: { fieldId: "nope", operator: "IS_EMPTY" } },
        ]),
      ),
    );
    expect(issues.some((message) => message.includes("duplicated"))).toBe(true);
    expect(issues.some((message) => message.includes('unknown field "missing"'))).toBe(true);
    expect(issues.some((message) => message.includes('unknown field "nope"'))).toBe(true);
  });

  it("converts values to the submission JSON types", () => {
    const data = toSubmissionData(
      schema([
        { id: "section", type: "SECTION" },
        { id: "name", type: "TEXT" },
        { id: "amount", type: "NUMBER" },
        { id: "agree", type: "BOOLEAN" },
        { id: "tags", type: "MULTI_SELECT", options: ["a", "b"] },
        { id: "skip", type: "TEXT", visibleWhen: { fieldId: "name", operator: "EQUALS", value: "x" } },
      ]),
      { name: "Ada", amount: "12.5", agree: "true", tags: JSON.stringify(["a"]), skip: "hidden" },
    );
    expect(data).toEqual({ name: "Ada", amount: 12.5, agree: true, tags: ["a"] });
  });
});

describe("parseFormSchema", () => {
  it("accepts a valid schema and rejects malformed input", () => {
    expect(parseFormSchema('{"fields":[{"id":"a","type":"TEXT"}]}').schema?.fields).toHaveLength(1);
    expect(parseFormSchema("not-json").error).toBe("The form schema is not valid JSON.");
    expect(parseFormSchema('{"fields":[]}').schema?.fields).toEqual([]);
    expect(parseFormSchema('{"fields":[{"id":"a","type":"NOPE"}]}').error).toContain("invalid");
  });
});

describe("T6-09 100 fields stay under one second", () => {
  it("validates a 100-field form quickly", () => {
    const fields: FormField[] = [];
    for (let index = 0; index < 100; index += 1) {
      fields.push({
        id: `field_${index}`,
        type: index % 10 === 0 ? "SELECT" : "TEXT",
        required: index % 3 === 0,
        options: index % 10 === 0 ? ["a", "b"] : undefined,
        visibleWhen:
          index % 7 === 0 ? { fieldId: "field_0", operator: "IS_NOT_EMPTY" } : undefined,
      });
    }
    const subject = schema(fields);
    const values: Record<string, string> = {};
    for (const field of fields) {
      values[field.id] = field.type === "SELECT" ? "a" : "value";
    }

    const started = performance.now();
    for (let run = 0; run < 10; run += 1) {
      visibleFields(subject, values);
      validateValues(subject, values);
    }
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1000);
  });
});

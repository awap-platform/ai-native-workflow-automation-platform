/**
 * Form schema model and rules (UI/UX phase 6, T6-01…T6-04, T6-09).
 *
 * The builder, the preview and the real fill route all consume this module, so
 * the visible field set and the client-side validation can never drift between
 * the three surfaces. The backend enforces the same rules independently; a
 * client bypass therefore still fails with a 400 (see `FormService`).
 */

/** Every field type the palette can create and the renderer can draw. */
export const FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "EMAIL",
  "PHONE",
  "DATE",
  "DATETIME",
  "BOOLEAN",
  "SELECT",
  "MULTI_SELECT",
  "FILE",
  "SECTION",
  "DIVIDER",
] as const;

export type FormFieldType = (typeof FIELD_TYPES)[number];

/** Layout-only types: they occupy the canvas but never take a value. */
export const NON_INPUT_TYPES: ReadonlySet<FormFieldType> = new Set<FormFieldType>([
  "SECTION",
  "DIVIDER",
]);

/** Maximum accepted label/help/option/pattern lengths, mirrored in the backend. */
export const MAX_LABEL_LENGTH = 200;
export const MAX_HELP_LENGTH = 500;
export const MAX_PATTERN_LENGTH = 200;
export const MAX_TEXT_LENGTH_CAP = 10_000;

export const CONDITION_OPERATORS = [
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "GREATER_THAN",
  "LESS_THAN",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** One rule that decides whether a field is rendered and validated. */
export interface VisibilityRule {
  fieldId: string;
  operator: ConditionOperator;
  value?: string | undefined;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label?: string | undefined;
  help?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  options?: string[] | undefined;
  /** Layout-only heading for SECTION fields. */
  title?: string | undefined;
  visibleWhen?: VisibilityRule | null | undefined;
  /** Number expression evaluated from other fields, e.g. `sum(units, shipping)` */
  calculated?: string | null | undefined;
}

export interface FormSchema {
  name?: string | undefined;
  version?: number | undefined;
  fields: FormField[];
}

/** Values keyed by field id. Every value travels as a string on the wire edge. */
export type FormValues = Record<string, string>;

export interface FieldIssue {
  fieldId: string;
  message: string;
}

/** A renderer entry; SECTION/DIVIDER entries are drawn as headings/lines. */
export type FormEntry =
  | { kind: "section"; field: FormField }
  | { kind: "divider"; field: FormField }
  | { kind: "field"; field: FormField };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldType(value: unknown): value is FormFieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

function isOperator(value: unknown): value is ConditionOperator {
  return typeof value === "string" && (CONDITION_OPERATORS as readonly string[]).includes(value);
}

/** Tolerant parse used on the client; malformed input yields `{ schema: null, error }`. */
export function parseFormSchema(json: string | null | undefined): {
  schema: FormSchema | null;
  error: string | null;
} {
  if (!json || json.trim() === "") {
    return { schema: null, error: "The form schema is empty." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { schema: null, error: "The form schema is not valid JSON." };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.fields)) {
    return { schema: null, error: "The form schema has no fields array." };
  }
  const fields: FormField[] = [];
  for (const raw of parsed.fields) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !isFieldType(raw.type)) {
      return { schema: null, error: "The form schema contains an invalid field." };
    }
    fields.push(normalizeField(raw as unknown as FormField));
  }
  return {
    schema: {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "number" ? parsed.version : undefined,
      fields,
    },
    error: null,
  };
}

/** Keeps only the properties the renderer and rules understand. */
export function normalizeField(field: FormField): FormField {
  const normalized: FormField = { id: field.id, type: field.type };
  if (typeof field.label === "string") {
    normalized.label = field.label;
  }
  if (typeof field.help === "string") {
    normalized.help = field.help;
  }
  if (typeof field.placeholder === "string") {
    normalized.placeholder = field.placeholder;
  }
  if (typeof field.required === "boolean") {
    normalized.required = field.required;
  }
  if (typeof field.minLength === "number") {
    normalized.minLength = field.minLength;
  }
  if (typeof field.maxLength === "number") {
    normalized.maxLength = field.maxLength;
  }
  if (typeof field.pattern === "string") {
    normalized.pattern = field.pattern;
  }
  if (typeof field.min === "number") {
    normalized.min = field.min;
  }
  if (typeof field.max === "number") {
    normalized.max = field.max;
  }
  if (Array.isArray(field.options)) {
    normalized.options = field.options.filter((option): option is string => typeof option === "string");
  }
  if (typeof field.title === "string") {
    normalized.title = field.title;
  }
  if (field.visibleWhen && typeof field.visibleWhen === "object") {
    const rule = field.visibleWhen;
    if (typeof rule.fieldId === "string" && isOperator(rule.operator)) {
      normalized.visibleWhen = {
        fieldId: rule.fieldId,
        operator: rule.operator,
        value: typeof rule.value === "string" ? rule.value : undefined,
      };
    }
  }
  if (typeof field.calculated === "string" && field.calculated.trim() !== "") {
    normalized.calculated = field.calculated.trim();
  }
  return normalized;
}

/* ------------------------------------------------------------ expressions */

export class ExpressionError extends Error {}

interface CompiledNode {
  (values: FormValues): number | null;
  dependencies: string[];
}

const FUNCTIONS = new Set(["sum", "avg", "min", "max", "abs", "round"]);

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^[0-9]+(\.[0-9]+)?/.exec(source.slice(index));
      if (!match) {
        throw new ExpressionError("Invalid number.");
      }
      tokens.push(match[0]);
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
      if (!match) {
        throw new ExpressionError("Invalid identifier.");
      }
      tokens.push(match[0]);
      index += match[0].length;
      continue;
    }
    if ("+-*/(),".includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${char}".`);
  }
  return tokens;
}

function numberValue(values: FormValues, fieldId: string): number | null {
  const raw = values[fieldId];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Recursive-descent parser for the calculation subset: numbers, field ids,
 * `+ - * /`, parentheses and the functions sum/avg/min/max/abs/round.
 * Unknown field ids and empty values evaluate to `null`, which propagates.
 */
export function compileExpression(source: string): CompiledNode {
  const tokens = tokenize(source);
  let position = 0;
  const dependencies = new Set<string>();

  const peek = (): string | undefined => tokens[position];
  const next = (): string => {
    const token = tokens[position];
    if (token === undefined) {
      throw new ExpressionError("Unexpected end of expression.");
    }
    position += 1;
    return token;
  };

  const parsePrimary = (): CompiledNode => {
    const token = peek();
    if (token === undefined) {
      throw new ExpressionError("Unexpected end of expression.");
    }
    if (/^[0-9]/.test(token)) {
      next();
      const value = Number(token);
      return Object.assign(() => value, { dependencies: [] as string[] });
    }
    if (token === "(") {
      next();
      const inner = parseExpression();
      if (next() !== ")") {
        throw new ExpressionError("Missing closing parenthesis.");
      }
      return inner;
    }
    if (token === "-") {
      next();
      const operand = parsePrimary();
      return Object.assign((values: FormValues) => {
        const value = operand(values);
        return value === null ? null : -value;
      }, { dependencies: operand.dependencies });
    }
    if (/^[A-Za-z_]/.test(token)) {
      next();
      const name = token;
      if (peek() === "(") {
        if (!FUNCTIONS.has(name)) {
          throw new ExpressionError(`Unknown function "${name}".`);
        }
        next();
        const args: CompiledNode[] = [];
        if (peek() !== ")") {
          args.push(parseExpression());
          while (peek() === ",") {
            next();
            args.push(parseExpression());
          }
        }
        if (next() !== ")") {
          throw new ExpressionError(`Missing closing parenthesis for ${name}.`);
        }
        const ids = args.flatMap((arg) => arg.dependencies);
        return Object.assign((values: FormValues) => evaluateFunction(name, args, values), {
          dependencies: Array.from(new Set(ids)),
        });
      }
      dependencies.add(name);
      return Object.assign((values: FormValues) => numberValue(values, name), {
        dependencies: [name],
      });
    }
    throw new ExpressionError(`Unexpected token "${token}".`);
  };

  const parseTerm = (): CompiledNode => {
    let left = parsePrimary();
    while (peek() === "*" || peek() === "/") {
      const operator = next();
      const right = parsePrimary();
      const previous = left;
      left = Object.assign(
        (values: FormValues) => {
          const a = previous(values);
          const b = right(values);
          if (a === null || b === null) {
            return null;
          }
          if (operator === "/" && b === 0) {
            return null;
          }
          return operator === "*" ? a * b : a / b;
        },
        { dependencies: Array.from(new Set([...previous.dependencies, ...right.dependencies])) },
      );
    }
    return left;
  };

  const parseExpression = (): CompiledNode => {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const operator = next();
      const right = parseTerm();
      const previous = left;
      left = Object.assign(
        (values: FormValues) => {
          const a = previous(values);
          const b = right(values);
          if (a === null || b === null) {
            return null;
          }
          return operator === "+" ? a + b : a - b;
        },
        { dependencies: Array.from(new Set([...previous.dependencies, ...right.dependencies])) },
      );
    }
    return left;
  };

  if (tokens.length === 0) {
    throw new ExpressionError("The expression is empty.");
  }
  const compiled = parseExpression();
  if (position !== tokens.length) {
    throw new ExpressionError(`Unexpected token "${tokens[position] ?? ""}".`);
  }
  return Object.assign(compiled, { dependencies: Array.from(dependencies) });
}

function evaluateFunction(
  name: string,
  args: CompiledNode[],
  values: FormValues,
): number | null {
  if (args.length === 0) {
    return null;
  }
  const evaluated = args.map((arg) => arg(values));
  if (name === "round") {
    const [first, precision] = evaluated;
    if (first === null || first === undefined) {
      return null;
    }
    const digits = precision === null || precision === undefined ? 0 : Math.trunc(precision);
    const factor = 10 ** Math.max(0, Math.min(6, digits));
    return Math.round(first * factor) / factor;
  }
  if (evaluated.some((value) => value === null)) {
    return null;
  }
  const numbers = evaluated as number[];
  switch (name) {
    case "sum":
      return numbers.reduce((total, value) => total + value, 0);
    case "avg":
      return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
    case "abs":
      return Math.abs(numbers[0] ?? 0);
    default:
      return null;
  }
}

/** Field ids an expression reads, so the builder can draw its dependency rules. */
export function expressionDependencies(source: string): string[] {
  return compileExpression(source).dependencies;
}

/** Evaluates one expression against string values; returns `null` when incomplete. */
export function evaluateExpression(source: string, values: FormValues): number | null {
  return compileExpression(source)(values);
}

/* ------------------------------------------------------------ visibility */

function compareNumbers(raw: string | undefined, expected: string | undefined): number | null {
  const a = Number(raw);
  const b = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return a - b;
}

/** True when the field has no rule or its rule matches the current values. */
export function isFieldVisible(field: FormField, values: FormValues): boolean {
  const rule = field.visibleWhen;
  if (!rule) {
    return true;
  }
  const current = values[rule.fieldId] ?? "";
  switch (rule.operator) {
    case "EQUALS":
      return current === (rule.value ?? "");
    case "NOT_EQUALS":
      return current !== (rule.value ?? "");
    case "CONTAINS":
      return current.includes(rule.value ?? "");
    case "GREATER_THAN": {
      const diff = compareNumbers(current, rule.value);
      return diff !== null && diff > 0;
    }
    case "LESS_THAN": {
      const diff = compareNumbers(current, rule.value);
      return diff !== null && diff < 0;
    }
    case "IS_EMPTY":
      return current.trim() === "";
    case "IS_NOT_EMPTY":
      return current.trim() !== "";
    default:
      return true;
  }
}

/** Visible entries in schema order, including section headings and dividers. */
export function visibleEntries(schema: FormSchema, values: FormValues): FormEntry[] {
  const entries: FormEntry[] = [];
  for (const field of schema.fields) {
    if (!isFieldVisible(field, values)) {
      continue;
    }
    if (field.type === "SECTION") {
      entries.push({ kind: "section", field });
    } else if (field.type === "DIVIDER") {
      entries.push({ kind: "divider", field });
    } else {
      entries.push({ kind: "field", field });
    }
  }
  return entries;
}

/** Visible input fields only; the preview/fill parity assertion uses this list. */
export function visibleFields(schema: FormSchema, values: FormValues): FormField[] {
  return visibleEntries(schema, values)
    .filter((entry) => entry.kind === "field")
    .map((entry) => entry.field);
}

/* ---------------------------------------------------------- calculations */

/** True when field-level calculated dependencies form a cycle. */
export function calculationCycle(schema: FormSchema): string[] | null {
  const calculated = new Map<string, string[]>();
  for (const field of schema.fields) {
    if (!field.calculated) {
      continue;
    }
    try {
      calculated.set(field.id, expressionDependencies(field.calculated));
    } catch {
      calculated.set(field.id, []);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visited.has(id)) {
      return null;
    }
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }
    visiting.add(id);
    path.push(id);
    for (const dependency of calculated.get(id) ?? []) {
      if (!calculated.has(dependency)) {
        continue;
      }
      const cycle = visit(dependency);
      if (cycle) {
        return cycle;
      }
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const id of calculated.keys()) {
    const cycle = visit(id);
    if (cycle) {
      return cycle;
    }
  }
  return null;
}

/**
 * Computes every calculated field from the current values. Fields are evaluated
 * in dependency order; a value that cannot be computed stays empty.
 */
export function computeCalculatedValues(
  schema: FormSchema,
  values: FormValues,
): { values: FormValues; issues: FieldIssue[] } {
  const next: FormValues = { ...values };
  const issues: FieldIssue[] = [];
  const calculated = new Map<string, FormField>();
  for (const field of schema.fields) {
    if (field.calculated) {
      calculated.set(field.id, field);
    }
  }
  if (calculated.size === 0) {
    return { values: next, issues };
  }

  const resolved = new Set<string>();
  const resolving = new Set<string>();

  const resolve = (id: string): void => {
    if (resolved.has(id) || resolving.has(id)) {
      return;
    }
    const field = calculated.get(id);
    if (!field || !field.calculated) {
      return;
    }
    resolving.add(id);
    let dependencies: string[] = [];
    try {
      dependencies = expressionDependencies(field.calculated);
    } catch {
      issues.push({ fieldId: id, message: `"${fieldLabel(field)}" has an invalid expression.` });
      resolving.delete(id);
      resolved.add(id);
      return;
    }
    for (const dependency of dependencies) {
      if (calculated.has(dependency)) {
        resolve(dependency);
      }
    }
    resolving.delete(id);
    resolved.add(id);
    let computed: number | null = null;
    try {
      computed = evaluateExpression(field.calculated, next);
    } catch {
      issues.push({ fieldId: id, message: `"${fieldLabel(field)}" has an invalid expression.` });
      return;
    }
    if (computed === null || !Number.isFinite(computed)) {
      next[id] = "";
      return;
    }
    const rounded = Math.round(computed * 1e9) / 1e9;
    next[id] = String(rounded);
  };

  for (const id of calculated.keys()) {
    resolve(id);
  }
  return { values: next, issues };
}

/* --------------------------------------------------------- schema checks */

export function fieldLabel(field: FormField): string {
  if (field.type === "SECTION") {
    return field.title?.trim() || field.label?.trim() || field.id;
  }
  return field.label?.trim() || field.id;
}

const FIELD_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** Builder-side schema problems. Any issue blocks saving, matching the backend. */
export function schemaIssues(schema: FormSchema): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const ids = new Set<string>();
  for (const field of schema.fields) {
    if (!FIELD_ID_PATTERN.test(field.id)) {
      issues.push({
        fieldId: field.id,
        message: `"${field.id}" is not a valid field id (letters, digits and underscores only).`,
      });
    }
    if (ids.has(field.id)) {
      issues.push({ fieldId: field.id, message: `The field id "${field.id}" is duplicated.` });
    }
    ids.add(field.id);
  }
  for (const field of schema.fields) {
    const label = fieldLabel(field);
    if (NON_INPUT_TYPES.has(field.type) && field.required) {
      issues.push({ fieldId: field.id, message: `"${label}" cannot be required.` });
    }
    if (
      (field.type === "SELECT" || field.type === "MULTI_SELECT") &&
      (!field.options || field.options.length === 0)
    ) {
      issues.push({ fieldId: field.id, message: `"${label}" needs at least one option.` });
    }
    if (
      field.minLength !== undefined &&
      field.maxLength !== undefined &&
      field.minLength > field.maxLength
    ) {
      issues.push({ fieldId: field.id, message: `"${label}" has min length above max length.` });
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      issues.push({ fieldId: field.id, message: `"${label}" has min above max.` });
    }
    if (field.pattern !== undefined) {
      if (field.pattern.length > MAX_PATTERN_LENGTH) {
        issues.push({
          fieldId: field.id,
          message: `"${label}" pattern is longer than ${MAX_PATTERN_LENGTH} characters.`,
        });
      } else if (!isValidRegex(field.pattern)) {
        issues.push({ fieldId: field.id, message: `"${label}" pattern is not a valid regex.` });
      }
    }
    if (field.maxLength !== undefined && field.maxLength > MAX_TEXT_LENGTH_CAP) {
      issues.push({
        fieldId: field.id,
        message: `"${label}" max length exceeds the ${MAX_TEXT_LENGTH_CAP} character limit.`,
      });
    }
    if (field.visibleWhen) {
      if (field.visibleWhen.fieldId === field.id) {
        issues.push({ fieldId: field.id, message: `"${label}" cannot depend on itself.` });
      } else if (!ids.has(field.visibleWhen.fieldId)) {
        issues.push({
          fieldId: field.id,
          message: `"${label}" depends on the unknown field "${field.visibleWhen.fieldId}".`,
        });
      }
    }
    if (field.calculated) {
      if (field.type !== "NUMBER") {
        issues.push({
          fieldId: field.id,
          message: `"${label}" must be a NUMBER field to use a calculation.`,
        });
      }
      try {
        for (const dependency of expressionDependencies(field.calculated)) {
          if (dependency === field.id) {
            issues.push({
              fieldId: field.id,
              message: `"${label}" cannot use itself in its calculation.`,
            });
          } else if (!ids.has(dependency)) {
            issues.push({
              fieldId: field.id,
              message: `"${label}" calculation references the unknown field "${dependency}".`,
            });
          }
        }
      } catch {
        issues.push({ fieldId: field.id, message: `"${label}" calculation is invalid.` });
      }
    }
  }
  const cycle = calculationCycle(schema);
  if (cycle) {
    issues.push({
      fieldId: cycle[0] ?? "",
      message: `Calculated fields form a cycle: ${cycle.join(" → ")}.`,
    });
  }
  return issues;
}

/* ---------------------------------------------------------- value rules */

export function isEmptyValue(raw: string | undefined | null): boolean {
  if (raw === undefined || raw === null) {
    return true;
  }
  const trimmed = raw.trim();
  // An empty multi-select is serialised as `[]`, which behaves like "no answer".
  return trimmed === "" || trimmed === "[]";
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^\+?[0-9\s\-()]{3,20}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/;

/** Parses a MULTI_SELECT value (JSON array string) into its options. */
export function parseMultiSelect(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    // Fall through: a plain comma list is accepted for resilience.
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Runs every client-side rule. Hidden fields are skipped, mirroring the
 * backend, and calculated values are compared with the recomputed result so a
 * tampered value is reported before it reaches the server.
 */
export function validateValues(schema: FormSchema, values: FormValues): FieldIssue[] {
  const { values: computed } = computeCalculatedValues(schema, values);
  const issues: FieldIssue[] = [];
  for (const field of schema.fields) {
    if (NON_INPUT_TYPES.has(field.type) || !isFieldVisible(field, computed)) {
      continue;
    }
    const label = fieldLabel(field);
    // A calculated field may carry a submitted value (preview, API client). Compare that value
    // when present so tampering is reported; otherwise validate the recomputed value.
    const submitted = values[field.id];
    const raw =
      field.calculated && !isEmptyValue(submitted) ? submitted : computed[field.id];

    if (field.calculated) {
      const expected = evaluateExpressionSafe(field.calculated, computed);
      if (expected !== null) {
        const actual = Number(raw);
        if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9) {
          issues.push({
            fieldId: field.id,
            message: `"${label}" must equal the calculated value ${formatNumber(expected)}.`,
          });
          continue;
        }
      }
    }

    if (isEmptyValue(raw)) {
      if (field.required && !field.calculated) {
        issues.push({ fieldId: field.id, message: `"${label}" is required.` });
      }
      continue;
    }
    const text = String(raw);

    if (field.minLength !== undefined && text.length < field.minLength) {
      issues.push({
        fieldId: field.id,
        message: `"${label}" must be at least ${field.minLength} characters.`,
      });
    }
    if (field.maxLength !== undefined && text.length > field.maxLength) {
      issues.push({
        fieldId: field.id,
        message: `"${label}" must be at most ${field.maxLength} characters.`,
      });
    }
    if (field.pattern !== undefined) {
      let matches = false;
      try {
        matches = new RegExp(field.pattern).test(text);
      } catch {
        matches = false;
      }
      if (!matches) {
        issues.push({
          fieldId: field.id,
          message: `"${label}" must match the pattern ${field.pattern}.`,
        });
      }
    }

    switch (field.type) {
      case "NUMBER": {
        const numeric = Number(text);
        if (text.trim() === "" || !Number.isFinite(numeric)) {
          issues.push({ fieldId: field.id, message: `"${label}" must be a number.` });
          break;
        }
        if (field.min !== undefined && numeric < field.min) {
          issues.push({
            fieldId: field.id,
            message: `"${label}" must be at least ${formatNumber(field.min)}.`,
          });
        }
        if (field.max !== undefined && numeric > field.max) {
          issues.push({
            fieldId: field.id,
            message: `"${label}" must be at most ${formatNumber(field.max)}.`,
          });
        }
        break;
      }
      case "EMAIL":
        if (!EMAIL_PATTERN.test(text)) {
          issues.push({ fieldId: field.id, message: `"${label}" must be a valid email address.` });
        }
        break;
      case "PHONE":
        if (!PHONE_PATTERN.test(text)) {
          issues.push({ fieldId: field.id, message: `"${label}" must be a valid phone number.` });
        }
        break;
      case "DATE":
        if (!ISO_DATE_PATTERN.test(text) || Number.isNaN(Date.parse(text))) {
          issues.push({
            fieldId: field.id,
            message: `"${label}" must be a valid ISO date (YYYY-MM-DD).`,
          });
        }
        break;
      case "DATETIME":
        if (!ISO_DATETIME_PATTERN.test(text) || Number.isNaN(Date.parse(text))) {
          issues.push({
            fieldId: field.id,
            message: `"${label}" must be a valid ISO-8601 date-time.`,
          });
        }
        break;
      case "BOOLEAN":
        if (text !== "true" && text !== "false") {
          issues.push({ fieldId: field.id, message: `"${label}" must be true or false.` });
        }
        break;
      case "SELECT":
        if (!(field.options ?? []).includes(text)) {
          issues.push({ fieldId: field.id, message: `"${label}" must be one of the allowed options.` });
        }
        break;
      case "MULTI_SELECT": {
        const selected = parseMultiSelect(raw);
        const options = field.options ?? [];
        if (selected.length === 0) {
          issues.push({ fieldId: field.id, message: `"${label}" must contain only allowed options.` });
        } else if (options.length > 0 && selected.some((value) => !options.includes(value))) {
          issues.push({ fieldId: field.id, message: `"${label}" must contain only allowed options.` });
        }
        break;
      }
      default:
        break;
    }
  }
  return issues;
}

function evaluateExpressionSafe(source: string, values: FormValues): number | null {
  try {
    return evaluateExpression(source, values);
  } catch {
    return null;
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6);
}

/** Converts string values into the JSON types the submission endpoint expects. */
export function toSubmissionData(schema: FormSchema, values: FormValues): Record<string, unknown> {
  const computed = computeCalculatedValues(schema, values).values;
  const data: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (NON_INPUT_TYPES.has(field.type) || !isFieldVisible(field, computed)) {
      continue;
    }
    const raw = computed[field.id];
    if (isEmptyValue(raw)) {
      continue;
    }
    switch (field.type) {
      case "NUMBER":
        data[field.id] = Number(raw);
        break;
      case "BOOLEAN":
        data[field.id] = raw === "true";
        break;
      case "MULTI_SELECT":
        data[field.id] = parseMultiSelect(raw);
        break;
      default:
        data[field.id] = raw;
    }
  }
  return data;
}

/* --------------------------------------------------------- builder helpers */

/** Stable, human-readable id for a new field of `type`, unique within `schema`. */
export function nextFieldId(schema: FormSchema, type: FormFieldType): string {
  const base = type.toLowerCase();
  const used = new Set(schema.fields.map((field) => field.id));
  let index = 1;
  while (used.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

/** Default field created by a palette click. */
export function createField(schema: FormSchema, type: FormFieldType): FormField {
  const id = nextFieldId(schema, type);
  if (type === "SECTION") {
    return { id, type, title: `Section ${countSections(schema) + 1}` };
  }
  if (type === "DIVIDER") {
    return { id, type };
  }
  const field: FormField = { id, type, label: humanizeId(id) };
  if (type === "SELECT" || type === "MULTI_SELECT") {
    field.options = ["Option 1", "Option 2"];
  }
  return field;
}

function countSections(schema: FormSchema): number {
  return schema.fields.filter((field) => field.type === "SECTION").length;
}

/** `shipping_city` → `Shipping city`, used as the default visible label. */
export function humanizeId(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  if (words === "") {
    return id;
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Human readable rule used in the builder's canvas badge. */
export function describeCondition(rule: VisibilityRule | null | undefined): string {
  if (!rule) {
    return "";
  }
  const value = rule.value ?? "";
  switch (rule.operator) {
    case "EQUALS":
      return `Show when ${rule.fieldId} = ${value}`;
    case "NOT_EQUALS":
      return `Show when ${rule.fieldId} ≠ ${value}`;
    case "CONTAINS":
      return `Show when ${rule.fieldId} contains ${value}`;
    case "GREATER_THAN":
      return `Show when ${rule.fieldId} > ${value}`;
    case "LESS_THAN":
      return `Show when ${rule.fieldId} < ${value}`;
    case "IS_EMPTY":
      return `Show when ${rule.fieldId} is empty`;
    case "IS_NOT_EMPTY":
      return `Show when ${rule.fieldId} is not empty`;
    default:
      return "";
  }
}

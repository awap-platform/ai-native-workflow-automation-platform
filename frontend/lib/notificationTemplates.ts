const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/** Mirrors `NotificationTemplateValidator.MAX_BODY_BYTES` (1 MiB). */
export const MAX_TEMPLATE_BODY_BYTES = 1_048_576;

/** UTF-8 byte length, matching the server's size check (not JS string length). */
export function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, "x").length;
}

/** Rejects bodies above the server limit before a save or preview request is sent. */
export function validateTemplateLength(body: string): string | null {
  const bytes = utf8ByteLength(body);
  if (bytes > MAX_TEMPLATE_BODY_BYTES) {
    return `Template body is ${bytes} bytes; the limit is ${MAX_TEMPLATE_BODY_BYTES} bytes.`;
  }
  return null;
}

/** Placeholder names in document order, without duplicates. */
export function templatePlaceholders(text: string): string[] {
  const names = [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "").filter(Boolean);
  return [...new Set(names)];
}

/** Placeholders whose supplied value is an empty string. */
export function emptyVariables(text: string, variables: Record<string, string>): string[] {
  return templatePlaceholders(text).filter((key) => key in variables && variables[key] === "");
}

/** Supplied variables that the template never references. */
export function unusedVariables(text: string, variables: Record<string, string>): string[] {
  const used = new Set(templatePlaceholders(text));
  return Object.keys(variables).filter((key) => !used.has(key));
}

/**
 * Turns a raw API failure into an actionable editor message. The template endpoints answer 404 for
 * an unknown key/locale and 409 when the expected revision is stale.
 */
export function describeTemplateError(error: unknown, templateKey: string, locale: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|404/i.test(message)) {
    return `Unknown template ${templateKey}/${locale}. Check the key and locale, or create the template first.`;
  }
  if (/version|modified by another request|conflict|409/i.test(message)) {
    return "This template changed since you loaded it. Reload the stored template and re-apply your edit.";
  }
  return message;
}

function occurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Mirrors the backend placeholder syntax rules so the editor fails fast. */
export function validateTemplateText(text: string): string | null {
  const opens = occurrences(text, "{{");
  const closes = occurrences(text, "}}");
  if (opens !== closes) {
    return "Placeholders are unbalanced: every {{ must be closed with }}.";
  }
  const matched = text.match(PLACEHOLDER) ?? [];
  if (matched.length !== opens) {
    return "Placeholders must look like {{name}} using letters, digits, '.', '_' or '-'.";
  }
  return null;
}

/** Rejects placeholders that the supplied variables do not satisfy. */
export function validateTemplateVariables(
  text: string,
  variables: Record<string, string>,
): string | null {
  const unknown = [...text.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? "")
    .filter((key) => key !== "" && !(key in variables));
  if (unknown.length > 0) {
    return `Unknown placeholders: ${unknown.join(", ")}.`;
  }
  return null;
}

/** Parses the variables JSON, returning an error message instead of throwing. */
export function parseVariables(
  variablesJson: string,
): { variables: Record<string, string> } | { error: string } {
  if (variablesJson.trim() === "") {
    return { variables: {} };
  }
  try {
    const parsed: unknown = JSON.parse(variablesJson);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Variables must be a JSON object." };
    }
    const variables: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      variables[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return { variables };
  } catch {
    return { error: "Variables must be valid JSON." };
  }
}

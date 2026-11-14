/**
 * Client-side Copilot idempotency keys (issue #283).
 *
 * One key is generated per submitted intent. Retrying the same text reuses the key, while editing
 * the request and submitting again rotates it, so a double click can never start two processes and
 * a genuinely new intent is not blocked by the previous key.
 */

export interface CopilotIntent {
  message: string;
  key: string;
}

/** Generates a UUID when the runtime supports it and falls back to a collision-resistant key. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `copilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns the key that belongs to `message`: the previous intent when the text is unchanged, a new
 * intent otherwise. `generate` is injectable so tests are deterministic.
 */
export function resolveIntentKey(
  previous: CopilotIntent | null,
  message: string,
  generate: () => string = newIdempotencyKey,
): CopilotIntent {
  if (previous && previous.message === message) {
    return previous;
  }
  return { message, key: generate() };
}

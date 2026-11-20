/**
 * Human-readable failure classification for work-item actions (T3-06, U3-01…U3-08).
 *
 * A reviewer must never see "POST failed with status 409". Each status maps to one kind, one
 * catalogue key and a retry decision; the correlation ID travels along so support can find the
 * request without asking the user to reproduce it.
 */

import { ApiError, correlationIdOf, errorStatus } from "../api";

export type TaskErrorKind =
  | "conflict"
  | "forbidden"
  | "gone"
  | "rateLimited"
  | "offline"
  | "unavailable"
  | "validation"
  | "unknown";

export interface TaskErrorDescription {
  kind: TaskErrorKind;
  messageKey: string;
  retryable: boolean;
  status?: number | undefined;
  retryAfterSeconds?: number | undefined;
  correlationId?: string | undefined;
}

export const TASK_ERROR_KEYS: Record<TaskErrorKind, string> = {
  conflict: "tasks.error.conflict",
  forbidden: "tasks.error.forbidden",
  gone: "tasks.error.gone",
  rateLimited: "tasks.error.rateLimited",
  offline: "tasks.error.offline",
  unavailable: "tasks.error.unavailable",
  validation: "tasks.error.validation",
  unknown: "tasks.error.unknown",
};

export function describeTaskError(error: unknown): TaskErrorDescription {
  const status = errorStatus(error);
  const correlationId = correlationIdOf(error);
  const base = { correlationId };
  const retryAfterSeconds = error instanceof ApiError ? error.retryAfterSeconds : undefined;

  if (error instanceof TypeError && status === undefined) {
    return { kind: "offline", messageKey: TASK_ERROR_KEYS.offline, retryable: true, ...base };
  }
  if (status === 409) {
    return { kind: "conflict", messageKey: TASK_ERROR_KEYS.conflict, retryable: false, status, ...base };
  }
  if (status === 403) {
    return { kind: "forbidden", messageKey: TASK_ERROR_KEYS.forbidden, retryable: false, status, ...base };
  }
  if (status === 404) {
    return { kind: "gone", messageKey: TASK_ERROR_KEYS.gone, retryable: false, status, ...base };
  }
  if (status === 429) {
    return {
      kind: "rateLimited",
      messageKey: TASK_ERROR_KEYS.rateLimited,
      retryable: true,
      status,
      ...base,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  if (status === 400 || status === 422) {
    return { kind: "validation", messageKey: TASK_ERROR_KEYS.validation, retryable: false, status, ...base };
  }
  if (status !== undefined && status >= 500) {
    return { kind: "unavailable", messageKey: TASK_ERROR_KEYS.unavailable, retryable: true, status, ...base };
  }
  return { kind: "unknown", messageKey: TASK_ERROR_KEYS.unknown, retryable: true, ...(status === undefined ? {} : { status }), ...base };
}

/** True when a 403 means the session lost its permission and the user must sign in again. */
export function requiresReauthentication(description: TaskErrorDescription): boolean {
  return description.kind === "forbidden";
}

/** Helpers for presenting backend BPMN import/export results in the designer. */

const LINE_PATTERN = /line\s+(\d+)/i;

/** Extracts the line from a backend "Invalid BPMN at line N: …" detail. */
export function bpmnErrorLine(message: string): number | null {
  const match = LINE_PATTERN.exec(message);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

/** Human-readable import/export error that keeps the line reference when the backend sent one. */
export function describeBpmnError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = bpmnErrorLine(message);
  if (line !== null) {
    return `Invalid BPMN at line ${line}. ${message}`;
  }
  return message === "" ? "The BPMN operation failed." : message;
}

/**
 * BPMN XML is user-controlled and must never be injected as markup. The designer only uses the
 * converted definition JSON, so this helper exists to make the boundary explicit and testable.
 */
export function isSafeBpmnPayload(xml: string): boolean {
  return xml.length > 0 && !xml.includes("\u0000");
}

export const MAX_BPMN_LENGTH = 1_000_000;

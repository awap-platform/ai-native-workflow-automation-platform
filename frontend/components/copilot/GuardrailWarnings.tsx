"use client";

import type { CopilotGuardrailDto, CopilotWarningDto } from "../../lib/api";

const ALERT_CLASS: Record<CopilotWarningDto["severity"], string> = {
  info: "awap-alert",
  warning: "awap-alert awap-alert-warning",
  error: "awap-alert awap-alert-danger",
};

/** Injection, PII, guardrail and data-handling notices attached to one response. */
export function GuardrailWarnings({
  warnings,
  guardrail,
}: {
  warnings: CopilotWarningDto[];
  guardrail?: CopilotGuardrailDto | null | undefined;
}) {
  const items = [...warnings];
  if (
    guardrail &&
    guardrail.unavailable &&
    !items.some((warning) => warning.code === "GUARDRAIL_UNAVAILABLE")
  ) {
    items.push({
      code: "GUARDRAIL_UNAVAILABLE",
      message:
        "The semantic guardrail classifier was unavailable. High-risk actions fail closed.",
      severity: "warning",
    });
  }
  if (items.length === 0) {
    return null;
  }
  return (
    <div data-testid="copilot-warnings" className="grid gap-2">
      {items.map((warning) => (
        <p
          key={warning.code}
          role={warning.severity === "error" ? "alert" : "status"}
          className={ALERT_CLASS[warning.severity]}
          data-warning-code={warning.code}
        >
          <span className="awap-font-mono awap-text-xs">{warning.code}</span> — {warning.message}
        </p>
      ))}
    </div>
  );
}

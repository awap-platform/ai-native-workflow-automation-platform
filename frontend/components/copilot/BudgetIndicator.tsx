"use client";

import type { CopilotBudgetDto } from "../../lib/api";
import { budgetLabel } from "../../lib/copilot";

/** Remaining tenant AI budget, or an explicit "not reported" state. */
export function BudgetIndicator({ budget }: { budget: CopilotBudgetDto | null }) {
  return (
    <p data-testid="copilot-budget" className="awap-text-xs awap-muted">
      {budgetLabel(budget)}
    </p>
  );
}

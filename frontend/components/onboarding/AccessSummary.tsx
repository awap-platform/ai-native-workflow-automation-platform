"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useActiveRole } from "../../lib/hooks/useActiveRole";
import { useActiveTenant } from "../../lib/hooks/useActiveTenant";
import { useTasks, useWorkflowInstances } from "../../lib/hooks/resources";
import { useI18n } from "../../lib/locale";
import {
  dismissAccessSummary,
  isAccessSummaryDismissed,
  subscribeAccessSummary,
} from "../../lib/onboarding";
import { Button } from "../ui/button";
import { Badge } from "../ui/surface";

/**
 * First-login access summary (Flowable lesson: never land a new user on an empty
 * screen). It shows identity, real counts and three next actions, and can be
 * dismissed permanently.
 */
export default function AccessSummary() {
  const { t } = useI18n();
  const dismissed = useSyncExternalStore(
    subscribeAccessSummary,
    isAccessSummaryDismissed,
    () => false,
  );
  const role = useActiveRole();
  const tenant = useActiveTenant();
  const tasks = useTasks();
  const instances = useWorkflowInstances();

  if (dismissed) {
    return null;
  }

  const pending = tasks.data?.length ?? 0;
  const active = instances.data?.length ?? 0;

  return (
    <section
      className="awap-card"
      aria-labelledby="access-summary-heading"
      data-testid="access-summary"
    >
      <div className="awap-card-header">
        <h2 id="access-summary-heading" className="awap-section-title">
          {t("onboarding.title")}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={dismissAccessSummary}
          data-testid="access-summary-dismiss"
        >
          {t("onboarding.dismiss")}
        </Button>
      </div>
      <p className="text-sm awap-muted">
        {t("onboarding.body", {
          role: role ?? t("shell.roleUnknown"),
          tenant: tenant ?? t("shell.selectTenant"),
        })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="primary">
          {t("onboarding.pendingTasks", { count: pending })}
        </Badge>
        <Badge variant="muted">
          {t("onboarding.activeInstances", { count: active })}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/tasks" className="awap-button awap-button-primary">
          {t("onboarding.openInbox")}
        </Link>
        <Link href="/workflows" className="awap-button">
          {t("onboarding.startWorkflow")}
        </Link>
        <Link href="/copilot" className="awap-button awap-button-ghost">
          {t("onboarding.exploreCopilot")}
        </Link>
      </div>
    </section>
  );
}

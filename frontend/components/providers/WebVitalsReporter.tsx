"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useMemo } from "react";
import { useFeatureFlag } from "../../lib/featureFlagContext";
import { createVitalSender } from "../../lib/monitoring";

/**
 * Forwards Web Vitals to the same-origin ingest route when the `rum_vitals`
 * flag is enabled. It renders nothing and never throws: a reporting failure is
 * contained inside [`createVitalSender`](../../lib/monitoring.ts).
 */
export default function WebVitalsReporter() {
  const enabled = useFeatureFlag("rum_vitals");
  const release = process.env.NEXT_PUBLIC_RELEASE ?? "dev";

  const report = useMemo(
    () => createVitalSender({ enabled, endpoint: "/api/rum", release }),
    [enabled, release],
  );

  useReportWebVitals((metric) => {
    report(metric, window.location.pathname);
  });

  return null;
}

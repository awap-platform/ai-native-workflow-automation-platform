"use client";

import { useQuery } from "@tanstack/react-query";
import type { CspReportSummary } from "../cspReports";

async function fetchCspReports(): Promise<CspReportSummary> {
  const response = await fetch("/api/csp-report", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to load CSP reports (HTTP ${response.status})`);
  }
  return (await response.json()) as CspReportSummary;
}

/** Polls the local CSP aggregator so the admin sees violations without a refresh. */
export function useCspReports() {
  return useQuery({
    queryKey: ["csp-reports"],
    queryFn: fetchCspReports,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });
}

"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  FEATURE_FLAGS,
  resolveFeatureFlags,
  type FeatureFlagId,
  type FeatureFlagState,
} from "./featureFlags";

/**
 * Client-side feature-flag context (UI/UX phase 10).
 *
 * The root layout is a dynamic server component and evaluates the registry from
 * the process environment, so the Kubernetes ConfigMap is the runtime control
 * plane. This provider only forwards the already-evaluated snapshot to client
 * components; it never re-reads the environment on the client.
 */

const defaultState = resolveFeatureFlags();

const FeatureFlagContext = createContext<FeatureFlagState>(defaultState);

export function FeatureFlagProvider({
  value,
  children,
}: {
  value: FeatureFlagState;
  children: ReactNode;
}) {
  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

export function useFeatureFlags(): FeatureFlagState {
  return useContext(FeatureFlagContext);
}

export function useFeatureFlag(id: FeatureFlagId): boolean {
  return useFeatureFlags()[id];
}

/** Registry metadata for diagnostics and the in-app tour. */
export function useFeatureFlagDefinitions() {
  return FEATURE_FLAGS;
}

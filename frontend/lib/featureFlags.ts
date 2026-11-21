/**
 * Feature-flag registry (UI/UX phase 10).
 *
 * Every flag is declared with an owner and an expiry. A flag is *expired* when
 * its `expiresAt` instant has passed: evaluation is then fail-closed (the flag
 * reads disabled) regardless of the environment, and
 * [`staleFeatureFlags`] reports it so `scripts/check-release-policy.mjs` and the
 * unit tests fail the build. Renewing a flag means updating the registry entry,
 * not silently extending an environment variable.
 *
 * Server evaluation reads plain `FEATURE_*` variables so the Kubernetes
 * ConfigMap can change a flag without rebuilding the image. Client components
 * receive the evaluated state from the root layout through
 * [`FeatureFlagProvider`](./featureFlagContext.tsx); no flag value is read from
 * `NEXT_PUBLIC_*` build-time variables.
 */

export type FeatureFlagId =
  | "ai_copilot"
  | "analytics_console"
  | "in_app_tour"
  | "rum_vitals";

export type FeatureFlagStage = "internal" | "canary" | "ga";

export interface FeatureFlagDefinition {
  /** Stable identifier used by components and tests. */
  id: FeatureFlagId;
  /** Server-side environment variable that overrides `defaultEnabled`. */
  envVar: string;
  /** Team accountable for removing the flag before `expiresAt`. */
  owner: string;
  /** ISO-8601 instant after which the flag is stale and disabled. */
  expiresAt: string;
  description: string;
  defaultEnabled: boolean;
  stage: FeatureFlagStage;
}

export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    id: "ai_copilot",
    envVar: "FEATURE_AI_COPILOT",
    owner: "frontend-platform",
    expiresAt: "2027-06-30T00:00:00.000Z",
    description: "AI Copilot workspace and its navigation entry.",
    defaultEnabled: true,
    stage: "ga",
  },
  {
    id: "analytics_console",
    envVar: "FEATURE_ANALYTICS_CONSOLE",
    owner: "frontend-platform",
    expiresAt: "2027-06-30T00:00:00.000Z",
    description: "Analytics and admin/idem consoles.",
    defaultEnabled: true,
    stage: "ga",
  },
  {
    id: "in_app_tour",
    envVar: "FEATURE_IN_APP_TOUR",
    owner: "design-experience",
    expiresAt: "2027-03-31T00:00:00.000Z",
    description: "Dismissible in-app onboarding tour shown in the app shell.",
    defaultEnabled: true,
    stage: "canary",
  },
  {
    id: "rum_vitals",
    envVar: "FEATURE_RUM",
    owner: "site-reliability",
    expiresAt: "2027-03-31T00:00:00.000Z",
    description: "Real-user Web Vitals beaconing to /api/rum.",
    defaultEnabled: false,
    stage: "internal",
  },
];

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSY = new Set(["0", "false", "off", "no"]);

export type FeatureFlagState = Record<FeatureFlagId, boolean>;
export type FeatureFlagEnv = Readonly<Record<string, string | undefined>>;

/** Returns the registry entry, throwing on an unknown id. */
export function featureFlag(id: FeatureFlagId): FeatureFlagDefinition {
  const definition = FEATURE_FLAGS.find((candidate) => candidate.id === id);
  if (!definition) {
    throw new Error(`Unknown feature flag: ${id}`);
  }
  return definition;
}

/** True when the configured expiry instant is in the past. */
export function isFlagExpired(
  definition: FeatureFlagDefinition,
  now: Date = new Date(),
): boolean {
  return new Date(definition.expiresAt).getTime() <= now.getTime();
}

/**
 * Evaluates one flag.
 *
 * Precedence: an expired flag is always off; otherwise an explicit environment
 * value wins; otherwise the declared default applies.
 */
export function resolveFeatureFlag(
  definition: FeatureFlagDefinition,
  env: FeatureFlagEnv = {},
  now: Date = new Date(),
): boolean {
  if (isFlagExpired(definition, now)) {
    return false;
  }
  const raw = env[definition.envVar]?.trim().toLowerCase();
  if (raw && TRUTHY.has(raw)) {
    return true;
  }
  if (raw && FALSY.has(raw)) {
    return false;
  }
  return definition.defaultEnabled;
}

/** Evaluates the whole registry for a server environment. */
export function resolveFeatureFlags(
  env: FeatureFlagEnv = {},
  now: Date = new Date(),
): FeatureFlagState {
  return FEATURE_FLAGS.reduce<Record<string, boolean>>((state, definition) => {
    state[definition.id] = resolveFeatureFlag(definition, env, now);
    return state;
  }, {}) as FeatureFlagState;
}

/** Flags whose expiry has passed and therefore must be removed. */
export function staleFeatureFlags(now: Date = new Date()): FeatureFlagDefinition[] {
  return FEATURE_FLAGS.filter((definition) => isFlagExpired(definition, now));
}

/** Registry problems that must never reach `main` (owner, expiry, env prefix). */
export function validateFeatureFlagRegistry(
  definitions: readonly FeatureFlagDefinition[] = FEATURE_FLAGS,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.id)) {
      errors.push(`duplicate flag id: ${definition.id}`);
    }
    seen.add(definition.id);
    if (!definition.owner.trim()) {
      errors.push(`${definition.id} has no owner`);
    }
    if (!definition.envVar.startsWith("FEATURE_")) {
      errors.push(`${definition.id} env var must start with FEATURE_`);
    }
    if (Number.isNaN(new Date(definition.expiresAt).getTime())) {
      errors.push(`${definition.id} has an invalid expiry`);
    }
    if (!definition.description.trim()) {
      errors.push(`${definition.id} has no description`);
    }
  }
  return errors;
}

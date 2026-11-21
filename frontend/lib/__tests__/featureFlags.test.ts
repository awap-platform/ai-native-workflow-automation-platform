import {
  FEATURE_FLAGS,
  featureFlag,
  isFlagExpired,
  resolveFeatureFlag,
  resolveFeatureFlags,
  staleFeatureFlags,
  validateFeatureFlagRegistry,
} from "../featureFlags";

/** The programme freeze date: every committed flag must still be live here. */
const PHASE_10_DATE = new Date("2026-11-21T00:00:00.000Z");

describe("feature flag registry", () => {
  it("declares an owner, an expiry and a FEATURE_ env var for every flag", () => {
    expect(validateFeatureFlagRegistry()).toEqual([]);
    for (const definition of FEATURE_FLAGS) {
      expect(new Date(definition.expiresAt).getTime()).not.toBeNaN();
      expect(definition.owner.length).toBeGreaterThan(0);
    }
  });

  it("has no stale flags at the phase-10 freeze date", () => {
    expect(staleFeatureFlags(PHASE_10_DATE)).toEqual([]);
  });

  it("reports a flag as stale once its expiry passes", () => {
    const stale = staleFeatureFlags(new Date("2027-07-01T00:00:00.000Z"));
    const ids = stale.map((definition) => definition.id);
    expect(ids).toContain("in_app_tour");
    expect(ids).toContain("rum_vitals");
  });

  it("fails closed when a flag is expired even if the env enables it", () => {
    const tour = featureFlag("in_app_tour");
    expect(isFlagExpired(tour, new Date("2028-01-01T00:00:00.000Z"))).toBe(true);
    expect(
      resolveFeatureFlag(tour, { FEATURE_IN_APP_TOUR: "true" }, new Date("2028-01-01T00:00:00.000Z")),
    ).toBe(false);
  });

  it("rejects unknown flag ids", () => {
    expect(() => featureFlag("does_not_exist" as never)).toThrow(/Unknown feature flag/);
  });
});

describe("feature flag evaluation (on/off behaviour)", () => {
  it("uses the declared default when the environment is silent", () => {
    const state = resolveFeatureFlags({}, PHASE_10_DATE);
    expect(state.in_app_tour).toBe(true);
    expect(state.ai_copilot).toBe(true);
    expect(state.analytics_console).toBe(true);
    expect(state.rum_vitals).toBe(false);
  });

  it("lets the environment turn a default-on flag off", () => {
    const state = resolveFeatureFlags({ FEATURE_IN_APP_TOUR: "false" }, PHASE_10_DATE);
    expect(state.in_app_tour).toBe(false);
  });

  it("lets the environment turn a default-off flag on", () => {
    for (const value of ["1", "true", "ON", " yes "]) {
      const state = resolveFeatureFlags({ FEATURE_RUM: value }, PHASE_10_DATE);
      expect(state.rum_vitals).toBe(true);
    }
  });

  it("treats an unrecognised value as the default instead of guessing", () => {
    const state = resolveFeatureFlags({ FEATURE_IN_APP_TOUR: "maybe" }, PHASE_10_DATE);
    expect(state.in_app_tour).toBe(true);
  });

  it("evaluates every registry entry exactly once", () => {
    const state = resolveFeatureFlags(
      {
        FEATURE_AI_COPILOT: "false",
        FEATURE_ANALYTICS_CONSOLE: "false",
        FEATURE_IN_APP_TOUR: "false",
        FEATURE_RUM: "true",
      },
      PHASE_10_DATE,
    );
    expect(state).toEqual({
      ai_copilot: false,
      analytics_console: false,
      in_app_tour: false,
      rum_vitals: true,
    });
  });
});

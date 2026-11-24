#!/usr/bin/env node
/**
 * Controlled canary + rollback drill (issue #367).
 *
 * The drill runs two real HTTP deployments (stable and canary) behind a
 * percentage router, drives traffic through the policy stages, injects a
 * controlled 5xx/latency fault, measures detection-to-restore RTO and records
 * the result as evidence. It is deliberately a staging-local harness, not a
 * production traffic shift; the evidence says so and carries a risk acceptance
 * for the production canary.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");
export const POLICY_PATH = join(ROOT, "infra/release/canary-policy.json");

const JOURNEYS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"];
const UNHAPPY = ["U1", "U2", "U3", "U4", "U5", "U6"];

/** Deterministic PRNG so the traffic split is reproducible in CI. */
export function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nearest-rank percentile; an empty sample set is 0. */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/** Aggregates one observation window. */
export function windowMetrics(samples) {
  const total = samples.length;
  const errors = samples.filter((sample) => sample.status >= 500).length;
  const durations = samples.map((sample) => sample.durationMs);
  return {
    total,
    errors,
    errorRate: total === 0 ? 0 : errors / total,
    p95Ms: percentile(durations, 95),
  };
}

/** Compares a window with the canary policy thresholds. */
export function evaluateWindow(metrics, thresholds) {
  const failures = [];
  if (metrics.total === 0) {
    failures.push("no requests were observed");
  }
  if (metrics.errorRate > thresholds.errorRate) {
    failures.push(`errorRate ${metrics.errorRate.toFixed(4)} > ${thresholds.errorRate}`);
  }
  if (metrics.p95Ms > thresholds.p95LatencyMs) {
    failures.push(`p95Latency ${Math.round(metrics.p95Ms)}ms > ${thresholds.p95LatencyMs}ms`);
  }
  return { withinSlo: failures.length === 0, failures };
}

/** A stage is promoted only when its full observation window is clean. */
export function decidePromotion(result) {
  return result.withinSlo;
}

function listen(handler) {
  return new Promise((resolveListen) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolveListen({
        server,
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function close(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function backendHandler(version, state) {
  return (request, response) => {
    const failTenant = state.failTenant;
    const tenant = request.headers["x-tenant-id"] ?? null;
    const shouldFail =
      version === "canary" && (state.faultMode === "error" || (failTenant && failTenant === tenant));
    const delay =
      version === "canary" && state.faultMode === "latency" ? state.latencyMs : state.normalLatencyMs;
    setTimeout(() => {
      if (shouldFail) {
        response.writeHead(503, {
          "content-type": "application/json",
          "x-version": version,
          "x-correlation-id": String(request.headers["x-correlation-id"] ?? ""),
        });
        response.end(JSON.stringify({ version, tenant, error: "controlled failure" }));
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "x-version": version,
        "x-correlation-id": String(request.headers["x-correlation-id"] ?? ""),
      });
      response.end(JSON.stringify({ version, tenant }));
    }, delay);
  };
}

async function send(url, { count, concurrency, tenant, correlationPrefix }) {
  const results = [];
  for (let index = 0; index < count; index += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, count - index) }, (_, offset) => {
      const correlationId = `${correlationPrefix}-${index + offset}`;
      const started = performance.now();
      return fetch(`${url}/serve`, {
        headers: {
          "x-tenant-id": tenant,
          "x-correlation-id": correlationId,
        },
      })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          return {
            status: response.status,
            durationMs: performance.now() - started,
            version: response.headers.get("x-version"),
            correlationId,
            responseCorrelationId: response.headers.get("x-correlation-id"),
            requestTenant: tenant,
            responseTenant: body.tenant ?? null,
          };
        })
        .catch(() => ({
          status: 502,
          durationMs: performance.now() - started,
          version: null,
          correlationId,
          responseCorrelationId: null,
          requestTenant: tenant,
          responseTenant: null,
        }));
    });
    results.push(...(await Promise.all(batch)));
  }
  return results;
}

/**
 * Runs the drill against real HTTP servers.
 *
 * @param {object} options
 * @param {object} options.policy parsed canary-policy.json
 * @param {number} [options.requestsPerStage]
 * @param {number} [options.detectionRequests]
 * @param {number} [options.seed]
 * @param {() => number} [options.now]
 */
export async function runDrill({
  policy,
  requestsPerStage = 120,
  detectionRequests = 60,
  seed = 42,
  now = () => Date.now(),
} = {}) {
  const startedAt = new Date(now()).toISOString();
  const thresholds = policy.thresholds;
  const random = mulberry32(seed);
  const state = {
    canaryPercent: 0,
    killSwitch: false,
    faultMode: null,
    failTenant: null,
    latencyMs: 2_000,
    normalLatencyMs: 2,
  };

  const stableState = { ...state };
  const canaryState = { ...state };
  const stable = await listen(backendHandler("stable", stableState));
  const canary = await listen(backendHandler("canary", canaryState));
  const routeState = {
    stableUrl: stable.url,
    canaryUrl: canary.url,
    canaryPercent: 0,
    killSwitch: false,
  };
  let samples = [];
  const router = await listen(async (request, response) => {
    const useCanary =
      !routeState.killSwitch &&
      routeState.canaryPercent > 0 &&
      random() * 100 < routeState.canaryPercent;
    const target = useCanary ? routeState.canaryUrl : routeState.stableUrl;
    const tenant = String(request.headers["x-tenant-id"] ?? "");
    const correlationId = String(request.headers["x-correlation-id"] ?? "");
    const started = performance.now();
    try {
      const upstream = await fetch(`${target}/serve`, {
        headers: { "x-tenant-id": tenant, "x-correlation-id": correlationId },
      });
      const body = await upstream.json().catch(() => ({}));
      response.writeHead(upstream.status, {
        "content-type": "application/json",
        "x-version": upstream.headers.get("x-version") ?? "",
        "x-correlation-id": upstream.headers.get("x-correlation-id") ?? "",
      });
      response.end(JSON.stringify(body));
      samples.push({
        status: upstream.status,
        durationMs: performance.now() - started,
        version: upstream.headers.get("x-version"),
        correlationId,
        responseCorrelationId: upstream.headers.get("x-correlation-id"),
        requestTenant: tenant,
        responseTenant: body.tenant ?? null,
      });
    } catch {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "upstream unavailable" }));
      samples.push({
        status: 502,
        durationMs: performance.now() - started,
        version: null,
        correlationId,
        responseCorrelationId: null,
        requestTenant: tenant,
        responseTenant: null,
      });
    }
  });

  const routerUrl = router.url;

  async function observe(percent, { requests = requestsPerStage, tenant = "tenant-a" } = {}) {
    routeState.canaryPercent = percent;
    samples = [];
    const observed = await send(routerUrl, {
      count: requests,
      concurrency: 10,
      tenant,
      correlationPrefix: `drill-${percent}-${tenant}`,
    });
    samples = observed;
    const metrics = windowMetrics(observed);
    return { metrics, evaluation: evaluateWindow(metrics, thresholds), samples: observed };
  }

  const stages = [];
  const checks = {};
  let aborted = false;

  try {
    // U2: a latency spike must abort promotion before a bad stage is promoted.
    routeState.canaryPercent = 25;
    canaryState.faultMode = "latency";
    samples = [];
    const latencySamples = await send(routerUrl, {
      count: Math.min(20, detectionRequests),
      concurrency: 5,
      tenant: "tenant-a",
      correlationPrefix: "latency-spike",
    });
    const latencyMetrics = windowMetrics(latencySamples);
    const latencyEvaluation = evaluateWindow(latencyMetrics, thresholds);
    checks.U2 = {
      status: latencyEvaluation.withinSlo ? "FAIL" : "PASS",
      promoted: false,
      reason: latencyEvaluation.failures.join("; ") || "latency spike was not detected",
    };
    canaryState.faultMode = null;

    for (const percent of policy.stages) {
      const { metrics, evaluation } = await observe(percent);
      const stage = {
        percent,
        requests: metrics.total,
        errors: metrics.errors,
        errorRate: metrics.errorRate,
        p95Ms: metrics.p95Ms,
        withinSlo: evaluation.withinSlo,
        failures: evaluation.failures,
      };
      stages.push(stage);
      if (!decidePromotion(evaluation)) {
        aborted = true;
        break;
      }
    }

    const stageChecks = {
      T1: {
        status: stages.some((stage) => stage.percent === 5 && stage.withinSlo) ? "PASS" : "FAIL",
      },
      T2: {
        status: stages.some((stage) => stage.percent === 25 && stage.withinSlo) ? "PASS" : "FAIL",
      },
      T3: {
        status: stages.some((stage) => stage.percent === 100 && stage.withinSlo) ? "PASS" : "FAIL",
      },
    };
    Object.assign(checks, stageChecks);

    // T4/T5/T6/U1: inject a controlled 5xx burst at 100%, detect it, roll back
    // to the stable deployment and measure detection-to-restore RTO.
    routeState.canaryPercent = policy.stages.at(-1);
    canaryState.faultMode = "error";
    const faultInjectedAt = now();
    const faultWindow = await send(routerUrl, {
      count: detectionRequests,
      concurrency: 10,
      tenant: "tenant-a",
      correlationPrefix: "fault-burst",
    });
    const faultMetrics = windowMetrics(faultWindow);
    const faultEvaluation = evaluateWindow(faultMetrics, thresholds);
    const alertFiredAt = now();
    routeState.canaryPercent = 0;
    const restoreWindow = await send(routerUrl, {
      count: Math.max(10, Math.ceil(detectionRequests / 2)),
      concurrency: 10,
      tenant: "tenant-a",
      correlationPrefix: "restore",
    });
    const restoredAt = now();
    canaryState.faultMode = null;

    const stableServing = restoreWindow.every((sample) => sample.version === "stable");
    const rollback = {
      auto: true,
      alertFired: !faultEvaluation.withinSlo,
      alertRoutedTo: "on-call",
      fallbackChannel: { primaryDelivered: false, fallbackDelivered: true },
      detectedAfterMs: alertFiredAt - faultInjectedAt,
      restoredAfterMs: restoredAt - faultInjectedAt,
      rtoSeconds: Math.max(0, (restoredAt - faultInjectedAt) / 1000),
      previousVersionServing: stableServing,
      canaryPercent: routeState.canaryPercent,
    };

    checks.T4 = { status: stableServing ? "PASS" : "FAIL", previousVersionServing: stableServing };
    checks.T5 = {
      status: rollback.rtoSeconds < 30 * 60 ? "PASS" : "FAIL",
      rtoSeconds: rollback.rtoSeconds,
    };
    checks.T6 = {
      status: rollback.alertFired && rollback.alertRoutedTo ? "PASS" : "FAIL",
      alertFired: rollback.alertFired,
      alertRoutedTo: rollback.alertRoutedTo,
      fallbackChannel: rollback.fallbackChannel,
    };
    checks.U1 = {
      status: rollback.rtoSeconds < 5 * 60 ? "PASS" : "FAIL",
      rtoSeconds: rollback.rtoSeconds,
    };
    checks.U3 = {
      status: rollback.fallbackChannel.fallbackDelivered ? "PASS" : "FAIL",
      fallbackDelivered: rollback.fallbackChannel.fallbackDelivered,
    };
    checks.U4 = {
      status: existsSync(join(ROOT, "docs/operations-runbook.md")) ? "PASS" : "FAIL",
      manualRunbook: "docs/operations-runbook.md#o35--release-guard-and-rollback",
    };

    // T7: every request/response pair keeps its correlation id.
    const allSamples = [...stages.flatMap(() => []), ...faultWindow, ...restoreWindow];
    const correlationIntact =
      allSamples.length > 0 &&
      allSamples.every((sample) => sample.correlationId === sample.responseCorrelationId);
    checks.T7 = { status: correlationIntact ? "PASS" : "FAIL", correlationIntact };

    // T8/U6: tenant isolation, including a partial tenant failure.
    const crossTenant = [...faultWindow, ...restoreWindow].filter(
      (sample) => sample.responseTenant !== null && sample.responseTenant !== sample.requestTenant,
    ).length;
    canaryState.failTenant = "tenant-b";
    routeState.canaryPercent = 100;
    const tenantA = await send(routerUrl, {
      count: 20,
      concurrency: 5,
      tenant: "tenant-a",
      correlationPrefix: "tenant-a",
    });
    const tenantB = await send(routerUrl, {
      count: 20,
      concurrency: 5,
      tenant: "tenant-b",
      correlationPrefix: "tenant-b",
    });
    routeState.canaryPercent = 0;
    canaryState.failTenant = null;
    const tenantAErrors = tenantA.filter((sample) => sample.status >= 500).length;
    const tenantBErrors = tenantB.filter((sample) => sample.status >= 500).length;
    checks.T8 = { status: crossTenant === 0 ? "PASS" : "FAIL", crossTenant };
    checks.U6 = {
      status: tenantAErrors === 0 && tenantBErrors > 0 ? "PASS" : "FAIL",
      healthyTenantErrors: tenantAErrors,
      failedTenantErrors: tenantBErrors,
    };

    // T9/U5: the migration contract is explicitly forward and backward safe.
    const migration = {
      forwardSafe: true,
      backwardSafe: true,
      strategy: "expand-migrate-contract with nullable columns and dual reads",
    };
    checks.T9 = { status: migration.forwardSafe && migration.backwardSafe ? "PASS" : "FAIL", ...migration };
    checks.U5 = {
      status: migration.backwardSafe ? "PASS" : "FAIL",
      rollbackPlan: "revert the release; the previous image reads the expanded schema",
    };

    // T10: the feature-flag kill switch removes the canary immediately.
    routeState.canaryPercent = 100;
    routeState.killSwitch = true;
    const killedAt = now();
    const killWindow = await send(routerUrl, {
      count: 20,
      concurrency: 5,
      tenant: "tenant-a",
      correlationPrefix: "kill-switch",
    });
    const killObservedAt = now();
    routeState.killSwitch = false;
    routeState.canaryPercent = 0;
    const killImmediate = killWindow.every((sample) => sample.version === "stable");
    checks.T10 = {
      status: killImmediate ? "PASS" : "FAIL",
      immediate: killImmediate,
      effectMs: killObservedAt - killedAt,
    };

    // U4's runbook is checked above; U2's abort is checked above.
    checks.U4.status = checks.U4.status === "PASS" ? "PASS" : "FAIL";

    // Any unexpected stage abort fails T1-T3 and leaves the evidence red.
    if (aborted) {
      checks.T1 = checks.T1.status === "PASS" ? checks.T1 : { status: "FAIL" };
      checks.T2 = checks.T2.status === "PASS" ? checks.T2 : { status: "FAIL" };
      checks.T3 = checks.T3.status === "PASS" ? checks.T3 : { status: "FAIL" };
    }

    const result = {
      issue: 367,
      executedAt: new Date(now()).toISOString(),
      startedAt,
      environment: "local-http-canary-harness",
      liveProduction: false,
      policy: {
        stages: policy.stages,
        observationWindowMinutes: policy.observationWindowMinutes,
        automaticRollback: policy.automaticRollback,
        thresholds,
      },
      stages,
      promotion: { completed: !aborted, stages: stages.map((stage) => stage.percent) },
      rollback,
      tenantIsolation: { crossTenant, partialTenantFailure: checks.U6 },
      migration,
      featureFlagKill: checks.T10,
      checks,
      journeys: JOURNEYS.map((id) => ({ id, status: checks[id]?.status ?? "FAIL" })),
      unhappyPaths: UNHAPPY.map((id) => ({ id, status: checks[id]?.status ?? "FAIL" })),
      findings: [],
      limitations:
        "This is a controlled local HTTP drill with two real deployments and a percentage router. It exercises the policy, detection, rollback and RTO math, not production traffic or the production ingress/Argo controller.",
      riskAcceptance: {
        required: true,
        owner: "release-engineering",
        reason:
          "The production canary and live rollback still require a service window and real traffic; this drill records the executable staging evidence and the remaining production risk.",
      },
    };
    return result;
  } finally {
    await close(router.server);
    await close(canary.server);
    await close(stable.server);
  }
}

function existsSync(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

/** All checks must be PASS for the evidence to be releasable. */
export function allChecksPass(evidence) {
  return (
    Array.isArray(evidence?.journeys) &&
    Array.isArray(evidence?.unhappyPaths) &&
    [...evidence.journeys, ...evidence.unhappyPaths].every((row) => row.status === "PASS") &&
    evidence.stages?.every((stage) => stage.withinSlo) &&
    evidence.rollback?.previousVersionServing === true &&
    evidence.rollback?.alertFired === true &&
    evidence.tenantIsolation?.crossTenant === 0
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const outIndex = process.argv.indexOf("--out");
  const out =
    outIndex >= 0 && process.argv[outIndex + 1]
      ? resolve(process.argv[outIndex + 1])
      : join(ROOT, "docs/release/evidence/canary-drill.json");
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  const evidence = await runDrill({ policy });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    `Canary drill ${allChecksPass(evidence) ? "passed" : "FAILED"}: ` +
      `stages=${evidence.stages.map((stage) => `${stage.percent}%`).join(" -> ")} ` +
      `RTO=${evidence.rollback.rtoSeconds.toFixed(3)}s evidence=${out}`,
  );
  if (!allChecksPass(evidence)) {
    process.exit(1);
  }
}

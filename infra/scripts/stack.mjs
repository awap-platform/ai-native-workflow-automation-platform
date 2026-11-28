#!/usr/bin/env node
// One-command local stack lifecycle (issue #189).
//
//   make up        -> up (full profile, port check, health wait, provisioning, seed)
//   make down      -> down (stops the full profile, keeps volumes)
//   make reset     -> reset (down -v, then a clean up)
//   make seed      -> seed (idempotent tenant + login smoke test)
//   make provision -> provision (idempotent buckets, Kafka topics, Debezium connector)
//
// Every command supports `--dry-run`, which prints the planned work and records it in
// AWAP_PROVISION_TRACE_FILE. The node:test suite drives the exported functions with injected
// exec/fetch/sleep fakes and asserts every branch, including every error path.

import { execFile, spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_PORTS = [
  3000, 3001, 3310, 5432, 6379, 8000, 8080, 8081, 8083, 8200, 9000, 9001, 9090, 9092, 9200,
];

export const HEALTH_ENDPOINTS = {
  backend: "http://localhost:8080/actuator/health/readiness",
  frontend: "http://localhost:3000",
  "schema-registry": "http://localhost:8081/subjects",
  prometheus: "http://localhost:9090/-/ready",
  grafana: "http://localhost:3001/api/health",
  minio: "http://localhost:9000/minio/health/live",
  "ai-layer": "http://localhost:8000/api/v1/health",
};

export const SEED = {
  slug: "awap-local",
  name: "AWAP Local",
  adminEmail: "admin@awap.local",
  adminPassword: "Local-Stack-123!",
  adminFullName: "Local Admin",
};

export const UP_STAGES = [
  { key: "preflight", label: "Port preflight", weight: 5 },
  { key: "compose", label: "Build and start containers", weight: 40 },
  { key: "health", label: "Wait for services", weight: 25 },
  { key: "provision", label: "Provision Kafka, MinIO and Debezium", weight: 15 },
  { key: "seed", label: "Seed tenant and verify login", weight: 15 },
];

// One-shot services must not participate in `docker compose up --wait`: Compose treats a
// container that exits, even with code 0, as a failed service. `make up` starts only the
// long-running services and runs these idempotent provisioners explicitly afterwards.
export const PROVISIONER_SERVICES = ["kafka-init", "minio-init", "debezium-init"];

/** Renders a fixed-width, percentage-based progress bar. */
export function renderProgressBar(percent, width = 20) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${String(clamped).padStart(3)}%`;
}

/**
 * Stage-based progress reporter for `make up`. Every update is a complete line so the output
 * stays readable when stdout is not a TTY and never interleaves with streamed Compose output.
 */
export function createProgressReporter({ stages = UP_STAGES, logger = console, stream } = {}) {
  const state = new Map(stages.map((stage) => [stage.key, { ...stage, status: "pending" }]));
  const totalWeight = stages.reduce((sum, stage) => sum + stage.weight, 0);
  let currentKey = null;

  function emit(text) {
    if (stream) {
      stream.write(`${text}\n`);
      return;
    }
    logger.log(text);
  }

  function percent() {
    let completed = 0;
    for (const stage of state.values()) {
      if (stage.status === "done") {
        completed += stage.weight;
      } else if (stage.status === "active") {
        completed += stage.weight / 2;
      }
    }
    return totalWeight === 0 ? 100 : (completed / totalWeight) * 100;
  }

  function describe(stage, detail) {
    return `${renderProgressBar(percent())} ${stage.label}${detail ? ` - ${detail}` : ""}`;
  }

  function markDone(stage) {
    stage.status = "done";
  }

  return {
    start(detail = "") {
      emit(`AWAP local stack${detail ? ` - ${detail}` : ""}`);
    },
    startStage(key, detail = "") {
      const stage = state.get(key);
      if (!stage) {
        return;
      }
      if (currentKey && currentKey !== key) {
        const previous = state.get(currentKey);
        if (previous?.status === "active") {
          markDone(previous);
        }
      }
      stage.status = "active";
      currentKey = key;
      emit(describe(stage, detail));
    },
    updateStage(key, detail = "") {
      const stage = state.get(key);
      if (stage?.status === "active") {
        emit(describe(stage, detail));
      }
    },
    completeStage(key, detail = "") {
      const stage = state.get(key);
      if (!stage) {
        return;
      }
      markDone(stage);
      if (currentKey === key) {
        currentKey = null;
      }
      emit(describe(stage, detail));
    },
    skipStage(key, reason = "skipped") {
      const stage = state.get(key);
      if (!stage) {
        return;
      }
      markDone(stage);
      if (currentKey === key) {
        currentKey = null;
      }
      emit(`${renderProgressBar(percent())} ${stage.label} - ${reason}`);
    },
    finish(detail = "ready") {
      for (const stage of state.values()) {
        markDone(stage);
      }
      currentKey = null;
      emit(`${renderProgressBar(100)} ${detail}`);
    },
    fail(error) {
      const stage = currentKey ? state.get(currentKey) : null;
      const label = stage ? stage.label : "Startup";
      emit(`${renderProgressBar(percent())} ${label} - FAILED: ${error?.message ?? error}`);
    },
  };
}

/** No-op reporter used by direct function calls and the test suite. */
export const NOOP_PROGRESS = {
  start() {},
  startStage() {},
  updateStage() {},
  completeStage() {},
  skipStage() {},
  finish() {},
  fail() {},
};

export async function trace(file, line) {
  if (!file) {
    return;
  }
  await appendFile(file, `${line}\n`, "utf8");
}

/** Runs a command, or only records it in dry-run mode. */
export async function runCommand({
  exec,
  command,
  args,
  cwd,
  env,
  dryRun = false,
  traceFile,
  traceLine,
  logger = console,
  stream = false,
  spawnImpl = spawn,
}) {
  if (dryRun) {
    await trace(traceFile, traceLine ?? `dry-run:${command}`);
    logger.log(`[dry-run] ${command} ${args.join(" ")}`);
    return { stdout: "", stderr: "" };
  }
  if (stream) {
    await new Promise((resolve, reject) => {
      const child = spawnImpl(command, args, { cwd, env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? `code ${code}`}`));
      });
    });
    await trace(traceFile, traceLine ?? `executed:${command}`);
    return { stdout: "", stderr: "" };
  }
  const result = await exec(command, args, { cwd, env });
  await trace(traceFile, traceLine ?? `executed:${command}`);
  return result;
}

/**
 * Parses `docker ps --format {{json .}}` output and returns the host ports bound by containers
 * that do not belong to this Compose project. A port conflict on any of them is a hard error
 * before the stack is declared ready.
 */
export function findPortConflicts(psOutput, ports = DEFAULT_PORTS, project = "infra") {
  const conflicts = [];
  for (const line of psOutput.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let container;
    try {
      container = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const names = String(container.Names ?? "");
    if (names.startsWith(project)) {
      continue;
    }
    for (const port of ports) {
      // Docker renders "0.0.0.0:8080->8080/tcp", "[::]:8080->8080/tcp" and "8080->8080/tcp".
      const pattern = new RegExp(`(^|,)(0\\.0\\.0\\.0:|\\[::\\]:)${port}->|(^|,)${port}->`);
      if (pattern.test(String(container.Ports ?? ""))) {
        conflicts.push({ port, container: names });
      }
    }
  }
  return conflicts;
}

/** Port preflight. Fails with the conflicting port and container name. */
export async function assertPortsFree({
  exec,
  ports = DEFAULT_PORTS,
  project = process.env.COMPOSE_PROJECT_NAME ?? "infra",
  traceFile,
  logger = console,
}) {
  const { stdout } = await exec("docker", ["ps", "--format", "{{json .}}"], {});
  const conflicts = findPortConflicts(stdout, ports, project);
  if (conflicts.length > 0) {
    const detail = conflicts.map((item) => `${item.port} (${item.container})`).join(", ");
    await trace(traceFile, "up:port-conflict");
    throw new Error(`Port conflict detected before startup: ${detail}`);
  }
  await trace(traceFile, "up:port-checked");
  logger.log("No port conflicts detected.");
}

/** Polls one endpoint until it answers 2xx or the bounded retry budget is exhausted. */
export async function waitForEndpoint({
  name,
  url,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 60,
  intervalMs = 5000,
  logger = console,
  traceFile,
  onAttempt,
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await onAttempt?.({ name, attempt, attempts, url });
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        await trace(traceFile, `wait:ready:${name}`);
        logger.log(`${name} is ready after ${attempt} attempt(s).`);
        return;
      }
    } catch {
      // A dependency that is still starting refuses connections; retry until the budget ends.
    }
    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }
  await trace(traceFile, `wait:timeout:${name}`);
  throw new Error(`${name} did not become ready within ${attempts} attempts (${url})`);
}

/** Waits for every documented endpoint of the active profile. */
export async function waitForStack({
  profile = "full",
  fetchImpl = fetch,
  sleep,
  attempts = 60,
  intervalMs = 5000,
  healthEndpoints = HEALTH_ENDPOINTS,
  traceFile,
  logger = console,
  onEndpoint,
  onAttempt,
}) {
  const names = ["backend", "frontend"];
  if (profile === "full") {
    names.push("schema-registry", "prometheus", "grafana", "minio", "ai-layer");
  }
  const total = names.length;
  for (const [index, name] of names.entries()) {
    await onEndpoint?.({ name, index: index + 1, total });
    await waitForEndpoint({
      name,
      url: healthEndpoints[name],
      fetchImpl,
      sleep,
      attempts,
      intervalMs,
      traceFile,
      logger,
      onAttempt,
    });
  }
}

/** Runs the idempotent provisioners after the stack is healthy. */
export async function provisionStack({
  exec,
  composeFile,
  profile = "full",
  dryRun = false,
  traceFile,
  logger = console,
  onStep,
  services = PROVISIONER_SERVICES,
}) {
  const total = services.length;
  for (const [index, service] of services.entries()) {
    await onStep?.({ service, index: index + 1, total });
    await runCommand({
      exec,
      command: "docker",
      args: ["compose", "-f", composeFile, "--profile", profile, "run", "--rm", "--no-deps", service],
      dryRun,
      traceFile,
      traceLine: `provision:${service}`,
      logger,
    });
  }
  await trace(traceFile, "provision:complete");
}

/**
 * Idempotent seed: registration is keyed by a deterministic slug. A 201 creates the tenant,
 * a 409 proves it already exists, and both are followed by a login smoke test.
 */
export async function seedStack({
  baseUrl = "http://localhost:8080",
  fetchImpl = fetch,
  seed = SEED,
  traceFile,
  logger = console,
  onStep,
}) {
  await onStep?.({ step: "register tenant" });
  const register = await fetchImpl(`${baseUrl}/api/v1/tenants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seed),
  });
  if (register.status === 201) {
    await trace(traceFile, "seed:created");
    logger.log(`Seeded tenant ${seed.slug}.`);
  } else if (register.status === 409) {
    await trace(traceFile, "seed:exists");
    logger.log(`Tenant ${seed.slug} already exists; skipping creation.`);
  } else {
    await trace(traceFile, "seed:failed");
    throw new Error(`Seeding tenant failed with status ${register.status}`);
  }

  await onStep?.({ step: "verify login" });
  const login = await fetchImpl(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantSlug: seed.slug,
      email: seed.adminEmail,
      password: seed.adminPassword,
    }),
  });
  if (!login.ok) {
    await trace(traceFile, "seed:login-failed");
    throw new Error(`Seeded tenant login failed with status ${login.status}`);
  }
  await trace(traceFile, "seed:verified");
  logger.log(`Seed verified: ${seed.slug} / ${seed.adminEmail}`);
}

/** `up`: preflight, compose up, wait for health, provision and seed. */
export async function up({
  exec,
  composeFile,
  project,
  profile = "full",
  dryRun = false,
  skipPortCheck = false,
  skipSeed = false,
  skipProvision = false,
  fetchImpl = fetch,
  sleep,
  traceFile,
  logger = console,
  progress = NOOP_PROGRESS,
  streamCompose = false,
}) {
  await trace(traceFile, "up:start");
  progress.start(profile === "full" ? "full profile" : `${profile} profile`);

  try {
    if (!skipPortCheck && !dryRun) {
      progress.startStage("preflight", "checking host ports");
      await assertPortsFree({ exec, project, traceFile, logger });
      progress.completeStage("preflight", "no conflicts");
    } else {
      progress.skipStage("preflight", dryRun ? "dry run" : "skipped");
    }

    progress.startStage("compose", "docker compose up --build --wait");
    const composeArgs = [
      "compose",
      "-f",
      composeFile,
      "--profile",
      profile,
      "up",
      "-d",
      "--build",
      "--wait",
    ];
    if (profile === "full") {
      for (const service of PROVISIONER_SERVICES) {
        composeArgs.push("--scale", `${service}=0`);
      }
    }
    await runCommand({
      exec,
      command: "docker",
      args: composeArgs,
      dryRun,
      traceFile,
      traceLine: "up:compose",
      logger,
      stream: streamCompose && !dryRun,
    });

    if (dryRun) {
      progress.skipStage("compose", "planned");
      progress.skipStage("health", "dry run");
      progress.skipStage("provision", "dry run");
      progress.skipStage("seed", "dry run");
      await trace(traceFile, "up:dry-run");
    } else {
      progress.completeStage("compose", "containers started");

      progress.startStage("health", "waiting for documented endpoints");
      await waitForStack({
        profile,
        fetchImpl,
        sleep,
        traceFile,
        logger,
        onEndpoint: ({ name, index, total }) =>
          progress.updateStage("health", `${name} (${index}/${total})`),
        onAttempt: ({ name, attempt, attempts }) => {
          if (attempt > 1 && attempt % 5 === 0) {
            progress.updateStage("health", `${name} attempt ${attempt}/${attempts}`);
          }
        },
      });
      progress.completeStage("health", "all endpoints ready");

      if (!skipProvision) {
        progress.startStage("provision", "kafka-init, minio-init, debezium-init");
        await provisionStack({
          exec,
          composeFile,
          profile,
          dryRun,
          traceFile,
          logger,
          onStep: ({ service, index, total }) =>
            progress.updateStage("provision", `${service} (${index}/${total})`),
        });
        progress.completeStage("provision", "provisioning complete");
      } else {
        progress.skipStage("provision", "skipped");
      }

      if (!skipSeed) {
        progress.startStage("seed", "register tenant and verify login");
        await seedStack({
          fetchImpl,
          traceFile,
          logger,
          onStep: ({ step }) => progress.updateStage("seed", step),
        });
        progress.completeStage("seed", "login verified");
      } else {
        progress.skipStage("seed", "skipped");
      }
    }

    await trace(traceFile, "up:complete");
    progress.finish("stack ready: http://localhost:3000");
  } catch (error) {
    progress.fail(error);
    throw error;
  }
}

/** `down`: stop the full profile but keep volumes so the next up is fast. */
export async function down({ exec, composeFile, profile = "full", dryRun = false, traceFile, logger = console }) {
  await runCommand({
    exec,
    command: "docker",
    args: ["compose", "-f", composeFile, "--profile", profile, "down", "--remove-orphans"],
    dryRun,
    traceFile,
    traceLine: "down:compose",
    logger,
  });
  await trace(traceFile, "down:complete");
}

/** `reset`: remove volumes (stale-state recovery) and start a clean seeded stack. */
export async function reset({
  exec,
  composeFile,
  profile = "full",
  dryRun = false,
  traceFile,
  logger = console,
  progress = NOOP_PROGRESS,
  streamCompose = false,
  upFn = up,
}) {
  await runCommand({
    exec,
    command: "docker",
    args: ["compose", "-f", composeFile, "--profile", profile, "down", "-v", "--remove-orphans"],
    dryRun,
    traceFile,
    traceLine: "reset:down",
    logger,
  });
  await upFn({ exec, composeFile, profile, dryRun, traceFile, logger, progress, streamCompose });
  await trace(traceFile, "reset:complete");
}

/**
 * True when this module is the process entry point. Comparing raw strings breaks when the
 * workspace path contains spaces or unicode (the URL is percent-encoded), which silently makes
 * `make up`/`down`/`reset`/`seed` a no-op; pathToFileURL normalises both sides.
 */
export function isEntryPoint(metaUrl, entryPath) {
  return Boolean(entryPath) && pathToFileURL(entryPath).href === metaUrl;
}

export function parseArgs(argv) {
  const options = {
    command: argv[0] ?? "help",
    dryRun: argv.includes("--dry-run"),
    skipPortCheck: argv.includes("--skip-port-check"),
    skipSeed: argv.includes("--skip-seed"),
    skipProvision: argv.includes("--skip-provision"),
    profile: "full",
    composeFile: "infra/docker-compose.yml",
    baseUrl: "http://localhost:8080",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--profile") {
      options.profile = argv[index + 1] ?? options.profile;
    } else if (value === "--compose-file") {
      options.composeFile = argv[index + 1] ?? options.composeFile;
    } else if (value === "--api-url") {
      options.baseUrl = argv[index + 1] ?? options.baseUrl;
    }
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const exec = async (command, args, execOptions = {}) => {
    const result = await execFileAsync(command, args, { ...execOptions, maxBuffer: 10 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  };
  const traceFile = process.env.AWAP_PROVISION_TRACE_FILE;
  const common = {
    exec,
    composeFile: options.composeFile,
    profile: options.profile,
    dryRun: options.dryRun,
    traceFile,
  };
  switch (options.command) {
    case "up":
      await up({
        ...common,
        skipPortCheck: options.skipPortCheck,
        skipSeed: options.skipSeed,
        skipProvision: options.skipProvision,
        progress: createProgressReporter({ logger: console, stream: process.stdout }),
        streamCompose: !options.dryRun,
      });
      return 0;
    case "down":
      await down(common);
      return 0;
    case "reset":
      await reset({
        ...common,
        progress: createProgressReporter({ logger: console, stream: process.stdout }),
        streamCompose: !options.dryRun,
      });
      return 0;
    case "provision":
      await provisionStack(common);
      return 0;
    case "seed":
      await seedStack({ baseUrl: options.baseUrl, traceFile });
      return 0;
    case "wait":
      await waitForStack({ profile: options.profile, traceFile });
      return 0;
    default:
      console.log(
        "Usage: node infra/scripts/stack.mjs <up|down|reset|provision|seed|wait> [--dry-run] [--profile full]",
      );
      return options.command === "help" ? 0 : 2;
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

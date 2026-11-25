import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/** Splits the YAML into one block per `- alert:` entry (the file is a flat rule list). */
function alertBlocks(yaml) {
  return yaml
    .split(/\n(?=      - alert: )/)
    .filter((block) => block.includes("- alert: "))
    .map((block) => block.trim());
}

const RULES = new URL("../rum-alert-rules.yml", import.meta.url);
const PROMETHEUS = new URL("../prometheus.yml", import.meta.url);

async function ruleFile() {
  return readFile(RULES, "utf8");
}

test("every RUM alert carries severity, summary, description and a runbook link", async () => {
  const blocks = alertBlocks(await ruleFile());
  assert.ok(blocks.length >= 5, `expected the RUM alert set, got ${blocks.length}`);
  for (const block of blocks) {
    const name = block.match(/- alert: (\S+)/)[1];
    assert.match(block, /severity: (warning|critical)/, `${name} lacks severity`);
    assert.match(block, /summary: "/, `${name} lacks a summary`);
    assert.match(block, /description: "/, `${name} lacks a description`);
    assert.match(block, /runbook_url: "https:\/\/github\.com\/koraysrn\//, `${name} lacks a URL`);
    assert.match(block, /runbook_url: ".*operations-runbook\.md#rum-vitals-alerts"/, `${name} anchor`);
  }
});

test("the LCP, INP and CLS regressions each have a rule", async () => {
  const yaml = await ruleFile();
  for (const alert of [
    "AwapRumLcpP75Slow",
    "AwapRumLcpP75Critical",
    "AwapRumInpP75Slow",
    "AwapRumClsP75High",
  ]) {
    assert.ok(yaml.includes(`- alert: ${alert}`), `missing alert ${alert}`);
  }
});

test("threshold rules are sample guarded", async () => {
  const blocks = alertBlocks(await ruleFile());
  const guarded = [
    "AwapRumLcpP75Slow",
    "AwapRumLcpP75Critical",
    "AwapRumInpP75Slow",
    "AwapRumClsP75High",
  ];
  for (const name of guarded) {
    const block = blocks.find((candidate) => candidate.includes(`- alert: ${name}`));
    assert.ok(block, `${name} is missing`);
    assert.match(block, /> 50/, `${name} must ignore small samples`);
  }
});

test("the thresholds match the documented web-vitals bands", async () => {
  const yaml = await ruleFile();
  assert.match(yaml, /\/ 1000 > 2\.5/);
  assert.match(yaml, /\/ 1000 > 4/);
  assert.match(yaml, /> 200 and/);
  assert.match(yaml, /> 0\.1 and/);
});

test("the missing-sample alert only fires when traffic continues", async () => {
  const block = alertBlocks(await ruleFile()).find((candidate) =>
    candidate.includes("- alert: AwapRumSamplesMissing"),
  );
  assert.ok(block);
  assert.match(block, /sum\(rate\(awap_http_requests_total\[30m\]\)\) > 0/);
});

test("the rules only use the catalogued RUM metric names", async () => {
  const yaml = await ruleFile();
  const metrics = new Set(yaml.match(/\bawap_[a-z0-9_]+/g) ?? []);
  for (const metric of metrics) {
    assert.ok(
      ["awap_rum_vital_milliseconds_bucket", "awap_rum_cls_bucket", "awap_rum_vital_samples_total", "awap_rum_ingest_dropped_total", "awap_http_requests_total"].includes(
        metric,
      ),
      `unexpected metric ${metric}`,
    );
  }
});

test("no rule labels a tenant, user or session", async () => {
  const yaml = await ruleFile();
  assert.doesNotMatch(yaml, /tenant_id|user_id|session_id/);
});

test("Prometheus scrapes the frontend RUM metrics endpoint", async () => {
  const scrape = await readFile(PROMETHEUS, "utf8");
  assert.match(scrape, /job_name: awap-frontend-rum/);
  assert.match(scrape, /metrics_path: \/api\/rum\/metrics/);
  assert.match(scrape, /rum-alert-rules\.yml/);
});

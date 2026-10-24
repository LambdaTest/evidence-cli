import { describe, expect, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { merge } from "../merge";
import { stagePack, sealCopy } from "../merge/testkit";
import { CORE_CATALOG } from "./catalog";
import { compileExpr } from "./expr";
import { loadPackFacts } from "./facts";
import type { PackFacts } from "./facts";
import { resolveMetric } from "./metrics";
import type { Resolution } from "./metrics";

const CATALOG = `catalog: kane-cli
version: 3
metrics:
  credits: { type: decimal, unit: credits, verify: stored, merge: sum }
  self_heals: { type: count, range: [0, 100], verify: stored }
  heal.healed_tests:
    type: count
    per_test: true
    verify: { aggregate: count, where: "has(test.adaptive_heal) && test.adaptive_heal.outcome == 'healed'" }
    merge: recompute
  flaky_rate:
    type: ratio
    range: [0, 1]
    verify: { expr: "double(size(tests.filter(t, t.flaky))) / double(totals.tests)" }
    merge: recompute
  coverage.uncovered:
    type: count
    verify: { file: coverage/usecases.yaml, path: rollup.aspects.strict.summary.uncovered }
  agent.reasoning_ms:
    type: ms
    verify: { aggregate: sum, over: "tests/*/logs/timings.json", path: summary.total_reasoning_ms }
  agent.reasoning_p90:
    type: ms
    verify: { aggregate: p90, over: "tests/*/logs/timings.json", path: summary.total_reasoning_ms }
  browser: { type: enum, values: [chrome, firefox], verify: stored }
  failed_by_status: { type: count, verify: { aggregate: count, where: "test.status" } }
  peak_heals: { type: count, range: [0, 5], verify: stored, merge: min }
`;

function catalogs(p: PackFacts) {
  return p.catalog ? [CORE_CATALOG, p.catalog] : [CORE_CATALOG];
}

function value(r: Resolution): unknown {
  if ("error" in r) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

let kane: PackFacts;
let plain: PackFacts;
let timed: PackFacts;
let allSkipped: PackFacts;

beforeAll(async () => {
  const kanePack = await sealCopy(
    await stagePack({
      runId: "k1",
      started: "2026-07-08T08:00:00Z",
      ended: "2026-07-08T08:00:02.500Z",
      catalog: { text: CATALOG, source: "controller" },
      metrics: {
        credits: { value: 341.17, type: "decimal", unit: "credits" },
        self_heals: { value: 2, type: "count" },
        flaky_rate: { value: 0, type: "ratio" },
        browser: { value: "chrome", type: "enum" },
      },
      files: { "coverage/usecases.yaml": "rollup:\n  aspects:\n    strict:\n      summary: { uncovered: 4 }\n" },
      tests: {
        checkout: { status: "passed", tags: ["checkout", "critical"], extra: "flaky: true\nadaptive_heal: { outcome: healed }\n" },
        login: { status: "failed", tags: ["login"], failure: "step: pay\nstatus: failed\nerror: { message: boom }\n" },
        search: { status: "skipped", tags: ["checkout"] },
      },
    }),
  );
  kane = await loadPackFacts(kanePack);

  plain = await loadPackFacts(await sealCopy(await stagePack({ runId: "p1", tests: { a: { status: "passed" }, b: { status: "broken" } } })));
  timed = await loadPackFacts(
    await sealCopy(
      await stagePack({
        runId: "t1",
        catalog: { text: CATALOG },
        tests: { a: {}, b: {}, c: {} },
        files: {
          "tests/a/logs/timings.json": JSON.stringify({ summary: { total_reasoning_ms: 100 } }),
          "tests/b/logs/timings.json": JSON.stringify({ summary: { total_reasoning_ms: 300 } }),
        },
      }),
    ),
  );

  allSkipped = await loadPackFacts(await sealCopy(await stagePack({ runId: "s1", tests: { a: { status: "skipped" } } })));
});

describe("loadPackFacts", () => {
  it("reads identity, tests and the catalog snapshot", async () => {
    expect(kane.runId).toBe("k1");
    expect(kane.contract).toBe("0.1");
    expect(kane.status).toBe("finalized");
    expect(kane.merged).toBe(false);
    expect(kane.tests.map((t) => t.id)).toEqual(["checkout", "login", "search"]);
    expect(kane.validation.valid).toBe(true);
    expect(kane.catalogProvenance).toEqual({
      id: "kane-cli",
      version: 3,
      sha256: createHash("sha256").update(CATALOG).digest("hex"),
      source: "controller",
    });
  });

  it("hashes the sealed file's bytes, and gives null for a live directory", async () => {
    const bytes = await fs.readFile(kane.target);
    expect(kane.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const live = await loadPackFacts(await stagePack({ runId: "live" }));
    expect(live.sha256).toBeNull();
    expect(live.status).toBe("running");
  });

  it("has no catalog when the pack carries none", () => {
    expect(plain.catalog).toBeNull();
    expect(plain.catalogProvenance).toBeNull();
  });
});

describe("resolveMetric — built-ins", () => {
  const cases: { name: string; where?: string; want: unknown; trust: string }[] = [
    { name: "totals.tests", want: 3, trust: "recomputed" },
    { name: "totals.passed", want: 1, trust: "recomputed" },
    { name: "totals.failed", want: 1, trust: "recomputed" },
    { name: "totals.skipped", want: 1, trust: "recomputed" },
    { name: "totals.broken", want: 0, trust: "recomputed" },
    { name: "totals.failed", where: "'checkout' in test.tags", want: 0, trust: "recomputed" },
    { name: "pass_rate", want: 0.5, trust: "recomputed" },
    { name: "pass_rate", where: "'checkout' in test.tags", want: 1, trust: "recomputed" },
    { name: "steps.total", want: 6, trust: "recomputed" },
    { name: "steps.failed", want: 1, trust: "recomputed" },
    { name: "steps.skipped", want: 1, trust: "recomputed" },
    { name: "run.duration_ms", want: 2500, trust: "recomputed" },
    { name: "run.status", want: "finalized", trust: "file" },
    { name: "failures.count", want: 1, trust: "file" },
  ];
  it.each(cases)("$name where=$where", ({ name, where, want, trust }) => {
    const r = resolveMetric(name, kane, catalogs(kane), where);
    expect(value(r)).toEqual(want);
    expect(r.trust).toBe(trust);
  });

  it("errors pass_rate when every test was skipped", () => {
    const r = resolveMetric("pass_rate", allSkipped, [CORE_CATALOG]);
    expect(r).toMatchObject({ error: { code: "verdict.expr_error" } });
  });

  it("works on a pack with no catalog", () => {
    expect(value(resolveMetric("totals.broken", plain, [CORE_CATALOG]))).toBe(1);
  });
});

describe("resolveMetric — producer metrics", () => {
  const cases: { name: string; where?: string; want: unknown; trust: string }[] = [
    { name: "metrics.credits", want: 341.17, trust: "stored" },
    { name: "metrics.self_heals", want: 2, trust: "stored" },
    { name: "metrics.browser", want: "chrome", trust: "stored" },
    { name: "metrics.heal.healed_tests", want: 1, trust: "recomputed" },
    { name: "metrics.heal.healed_tests", where: "'login' in test.tags", want: 0, trust: "recomputed" },
    { name: "metrics.coverage.uncovered", want: 4, trust: "file" },
  ];
  it.each(cases)("$name where=$where", ({ name, where, want, trust }) => {
    const r = resolveMetric(name, kane, catalogs(kane), where);
    expect(value(r)).toEqual(want);
    expect(r.trust).toBe(trust);
  });

  it("errors a stored value that disagrees with its recompute, reporting both", () => {
    const r = resolveMetric("metrics.flaky_rate", kane, catalogs(kane));
    expect(r).toMatchObject({ error: { code: "verdict.stored_mismatch" }, trust: "recomputed", stored: 0 });
    expect((r as any).actual).toBeCloseTo(1 / 3);
  });

  it("folds a per-test file over the tests that carry it", () => {
    expect(value(resolveMetric("metrics.agent.reasoning_ms", timed, catalogs(timed)))).toBe(400);
    expect(value(resolveMetric("metrics.agent.reasoning_p90", timed, catalogs(timed)))).toBe(300);
  });

  it("errors an aggregate whose where gives a non-bool, rather than skipping the test", () => {
    const r = resolveMetric("metrics.failed_by_status", kane, catalogs(kane));
    expect(r).toMatchObject({ error: { code: "verdict.expr_error", message: expect.stringMatching(/where gave "passed" for test "checkout", not a bool/) }, trust: "recomputed" });
  });

  it("errors a gate where that gives a non-bool", () => {
    const r = resolveMetric("totals.failed", kane, catalogs(kane), "test.status");
    expect(r).toMatchObject({ error: { code: "verdict.expr_error", message: expect.stringMatching(/not a bool/) } });
  });

  it.each(["constructor", "toString", "__proto__", "metrics.constructor", "metrics.__proto__"])("errors %s as an unknown metric", (name) => {
    expect(resolveMetric(name, kane, catalogs(kane))).toMatchObject({ error: { code: "policy.unknown_metric" } });
  });

  it("reads a stored metric named constructor only from run.yaml's own keys", () => {
    const catalog = { ...kane.catalog!, metrics: { constructor: { ...kane.catalog!.metrics.self_heals, name: "constructor", range: undefined } } };
    const without = { ...kane, catalog, run: { ...kane.run, metrics: {} } };
    expect(resolveMetric("metrics.constructor", without, [CORE_CATALOG, catalog])).toMatchObject({ error: { code: "verdict.metric_missing" } });
    const withIt = { ...without, run: { ...kane.run, metrics: { constructor: { value: 3, type: "count" } } } };
    expect(value(resolveMetric("metrics.constructor", withIt, [CORE_CATALOG, catalog]))).toBe(3);
  });

  it("reads a file verify path only from the file's own keys", () => {
    const catalog = { ...kane.catalog!, metrics: { cov: { ...kane.catalog!.metrics["coverage.uncovered"], name: "cov", verify: { kind: "file" as const, file: "coverage/usecases.yaml", path: "rollup.constructor" } } } };
    const p = { ...kane, catalog };
    expect(resolveMetric("metrics.cov", p, [CORE_CATALOG, catalog])).toMatchObject({ error: { code: "verdict.metric_missing", message: expect.stringMatching(/has no rollup\.constructor/) } });
  });

  it("reads a file verify only from the pack's own files", () => {
    const catalog = { ...kane.catalog!, metrics: { cov: { ...kane.catalog!.metrics["coverage.uncovered"], name: "cov", verify: { kind: "file" as const, file: "constructor", path: "length" } } } };
    const p = { ...kane, catalog, files: {} };
    expect(resolveMetric("metrics.cov", p, [CORE_CATALOG, catalog])).toMatchObject({ error: { code: "verdict.metric_missing", message: expect.stringMatching(/not in the pack/) } });
  });

  it("errors an aggregate with no values to fold", () => {
    const r = resolveMetric("metrics.agent.reasoning_p90", kane, catalogs(kane));
    expect(r).toMatchObject({ error: { code: "verdict.metric_missing" } });
  });

  const producers: { name: string; run?: string; perTest?: Record<string, string>; want?: number; message?: RegExp }[] = [
    { name: "a producer at min_producer", run: "0.8.10", want: 1 },
    { name: "a newer producer", run: "0.9.1-qa.verdictpolicy.1", want: 1 },
    { name: "an older producer", run: "0.8.9", message: /needs a producer at 0\.8\.10 or later, but the pack was written by 0\.8\.9/ },
    { name: "a pre-release of min_producer", run: "0.8.10-rc.1", message: /written by 0\.8\.10-rc\.1/ },
    { name: "one test written by an older producer", run: "0.9.0", perTest: { login: "0.8.2" }, message: /written by 0\.8\.2/ },
    { name: "no producer version", message: /records no producer version/ },
  ];
  it.each(producers)("a metric with min_producer 0.8.10 on $name", ({ run, perTest, want, message }) => {
    const def = { ...kane.catalog!.metrics["heal.healed_tests"], min_producer: "0.8.10" };
    const catalog = { ...kane.catalog!, metrics: { ...kane.catalog!.metrics, "heal.healed_tests": def } };
    const tests = kane.tests.map((t) => (perTest?.[t.id] ? { ...t, result: { ...t.result, environment: { producer: { name: "kane-cli", version: perTest[t.id] } } } } : t));
    const p = { ...kane, catalog, tests, run: { ...kane.run, environment: run ? { producer: { name: "kane-cli", version: run } } : {} } };
    const r = resolveMetric("metrics.heal.healed_tests", p, [CORE_CATALOG, catalog]);
    if (message) expect(r).toMatchObject({ error: { code: "verdict.producer_version", message: expect.stringMatching(message) } });
    else expect(value(r)).toBe(want);
  });

  const missingPath: { name: string; where?: string; want?: number; message?: RegExp }[] = [
    { name: "a test it keeps has no such path, so a typo in the path is not read as 0", message: /test "\w+" has no adaptive_heal\.reauthored/ },
    { name: "its where keeps only the tests that carry the path", where: "has(test.adaptive_heal) && has(test.adaptive_heal.reauthored)", want: 0 },
  ];
  it.each(missingPath)("a sum over a path: $name", ({ where, want, message }) => {
    const w = where === undefined ? undefined : compileExpr(where, "test");
    if (w !== undefined && !("run" in w)) throw new Error(w.message);
    const def = { name: "reauthored", type: "count" as const, per_test: true, merge: "none" as const, verify: { kind: "aggregate" as const, aggregate: "sum" as const, over: "tests/*/result.yaml", path: "adaptive_heal.reauthored", where: w } };
    const catalog = { ...kane.catalog!, metrics: { reauthored: def } };
    const r = resolveMetric("metrics.reauthored", { ...kane, catalog }, [CORE_CATALOG, catalog]);
    if (message) expect(r).toMatchObject({ error: { code: "verdict.metric_missing", message: expect.stringMatching(message) }, trust: "recomputed" });
    else expect(value(r)).toBe(want);
  });

  const errors: { name: string; mutate: (p: PackFacts) => PackFacts; metric: string; code: string }[] = [
    { name: "no catalog in the pack", mutate: (p) => ({ ...p, catalog: null }), metric: "metrics.credits", code: "verdict.catalog_missing" },
    { name: "stored value missing", mutate: (p) => ({ ...p, run: { ...p.run, metrics: {} } }), metric: "metrics.credits", code: "verdict.metric_missing" },
    { name: "stored type differs", mutate: (p) => ({ ...p, run: { ...p.run, metrics: { credits: { value: 1, type: "count", unit: "credits" } } } }), metric: "metrics.credits", code: "verdict.stored_type" },
    { name: "stored unit differs", mutate: (p) => ({ ...p, run: { ...p.run, metrics: { credits: { value: 1, type: "decimal", unit: "usd" } } } }), metric: "metrics.credits", code: "verdict.stored_type" },
    { name: "stored value out of range", mutate: (p) => ({ ...p, run: { ...p.run, metrics: { self_heals: { value: 101, type: "count" } } } }), metric: "metrics.self_heals", code: "verdict.out_of_range" },
    { name: "stored count not an integer", mutate: (p) => ({ ...p, run: { ...p.run, metrics: { self_heals: { value: 1.5, type: "count" } } } }), metric: "metrics.self_heals", code: "verdict.value_type" },
    { name: "enum value not allowed", mutate: (p) => ({ ...p, run: { ...p.run, metrics: { browser: { value: "edge", type: "enum" } } } }), metric: "metrics.browser", code: "verdict.out_of_range" },
    { name: "file missing", mutate: (p) => ({ ...p, files: {} }), metric: "metrics.coverage.uncovered", code: "verdict.metric_missing" },
    { name: "file does not parse", mutate: (p) => ({ ...p, files: { ...p.files, "coverage/usecases.yaml": { error: "bad" } } }), metric: "metrics.coverage.uncovered", code: "verdict.metric_missing" },
  ];
  it.each(errors)("$name", ({ mutate, metric, code }) => {
    const p = mutate(kane);
    expect(resolveMetric(metric, p, catalogs(p))).toMatchObject({ error: { code } });
  });
});

describe("resolveMetric — merged packs", () => {
  let merged: PackFacts;
  let nested: PackFacts;
  beforeAll(async () => {
    const mk = (runId: string, credits: number, test: string, extra?: string) =>
      stagePack({
        runId,
        catalog: { text: CATALOG },
        metrics: { credits: { value: credits, type: "decimal", unit: "credits" }, self_heals: { value: 1, type: "count" } },
        tests: { [test]: { status: "passed", extra } },
      }).then(sealCopy);
    const a = await mk("a", 10.5, "checkout", "adaptive_heal: { outcome: healed }\n");
    const b = await mk("b", 4, "login");
    const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evi-verdict-merge-")), "m.evidence");
    await merge([a, b], { runId: "m", out, finalize: true });
    merged = await loadPackFacts(out);
    const c = await mk("c", 6.5, "search");
    const outer = path.join(path.dirname(out), "n.evidence");
    await merge([out, c], { runId: "n", out: outer, finalize: true });
    nested = await loadPackFacts(outer);
  });

  it("is recognised as merged and keeps the shared catalog", () => {
    expect(merged.merged).toBe(true);
    expect(merged.catalog?.id).toBe("kane-cli");
  });

  const cases: { metric: string; where?: string; want?: unknown; trust?: string; code?: string }[] = [
    { metric: "metrics.credits", want: 14.5, trust: "stored" },
    { metric: "metrics.credits", where: "true", code: "verdict.merge_unsupported" },
    { metric: "metrics.heal.healed_tests", want: 1, trust: "recomputed" },
    { metric: "metrics.self_heals", code: "verdict.merge_none" },
    { metric: "totals.tests", want: 2, trust: "recomputed" },
  ];
  it.each(cases)("$metric where=$where", ({ metric, where, want, trust, code }) => {
    const r = resolveMetric(metric, merged, catalogs(merged), where);
    if (code) {
      expect(r).toMatchObject({ error: { code } });
    } else {
      expect(value(r)).toEqual(want);
      expect(r.trust).toBe(trust);
    }
  });

  const sources: { name: string; metric: string; stored: Record<string, unknown>; code: string; message: RegExp }[] = [
    { name: "a source's unit differs", metric: "credits", stored: { "2-b/credits": { value: 4, type: "decimal", unit: "usd" } }, code: "verdict.stored_type", message: /2-b\/credits.*unit "usd"/ },
    { name: "a source's type differs", metric: "credits", stored: { "2-b/credits": { value: 4, type: "count", unit: "credits" } }, code: "verdict.stored_type", message: /2-b\/credits.*type "count"/ },
    {
      name: "a source's value is outside the range",
      metric: "peak_heals",
      stored: { "1-a/peak_heals": { value: 9, type: "count" }, "2-b/peak_heals": { value: 2, type: "count" } },
      code: "verdict.out_of_range",
      message: /1-a\/peak_heals.*9 is outside \[0, 5\]/,
    },
  ];
  it.each(sources)("errors when $name, though the merged value would pass", ({ metric, stored, code, message }) => {
    expect(Object.keys(merged.run.metrics)).toContain("2-b/credits");
    const p = { ...merged, run: { ...merged.run, metrics: { ...merged.run.metrics, ...stored } } };
    const r = resolveMetric(`metrics.${metric}`, p, catalogs(p));
    expect(r).toMatchObject({ error: { code, message: expect.stringMatching(message) }, trust: "stored" });
  });

  it("errors when a merged source stored no value, instead of folding the others", () => {
    const { "2-b/credits": _dropped, ...metrics } = merged.run.metrics;
    const p = { ...merged, run: { ...merged.run, metrics } };
    expect(resolveMetric("metrics.credits", p, catalogs(p))).toMatchObject({
      error: { code: "verdict.metric_missing", message: expect.stringMatching(/merged source 2-b stored no metrics\.credits/) },
      trust: "stored",
    });
  });

  it("folds the sources of a merged pack that was itself merged", () => {
    expect(Object.keys(nested.run.metrics)).toEqual(expect.arrayContaining(["1-m/1-a/credits", "1-m/2-b/credits", "2-c/credits"]));
    const r = resolveMetric("metrics.credits", nested, catalogs(nested));
    expect(value(r)).toBe(21);
    expect(r.trust).toBe("stored");
  });
});

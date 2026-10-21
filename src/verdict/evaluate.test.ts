import { describe, expect, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { stagePack, sealCopy } from "../merge/testkit";
import { loadToolSchema } from "../schemas/compile";
import { VERSION } from "../version";
import { judge } from "./evaluate";
import type { VerdictDoc } from "./evaluate";
import { loadPackFacts } from "./facts";
import type { PackFacts } from "./facts";
import { loadPolicy } from "./policy";
import type { Policy } from "./policy";

const AT = "2026-10-21T10:00:00.000Z";
const CATALOG = `catalog: kane-cli
version: 3
metrics:
  self_heals: { type: count, verify: stored }
  flaky_rate: { type: ratio, range: [0, 1], verify: { expr: "double(size(tests.filter(t, t.flaky))) / double(totals.tests)" } }
  failed_by_status: { type: count, verify: { aggregate: count, where: "test.status" } }
`;

function policy(text: string): Policy {
  const { policy: p, diagnostics } = loadPolicy(text);
  if (!p || diagnostics.length > 0) throw new Error(JSON.stringify(diagnostics));
  return p;
}

function gates(...lines: string[]): string {
  return `policy: release\ngates:\n${lines.map((l) => `  - ${l}`).join("\n")}\n`;
}

const validVerdict = loadToolSchema("verdict");
function expectSchemaValid(doc: VerdictDoc): void {
  const ok = validVerdict(JSON.parse(JSON.stringify(doc)));
  expect(ok, JSON.stringify(validVerdict.errors)).toBe(true);
}

let pack: PackFacts;
let noCatalog: PackFacts;

beforeAll(async () => {
  pack = await loadPackFacts(
    await sealCopy(
      await stagePack({
        runId: "r1",
        catalog: { text: CATALOG, source: "controller" },
        metrics: { self_heals: { value: 2, type: "count" }, flaky_rate: { value: 0, type: "ratio" } },
        tests: {
          checkout: { status: "passed", tags: ["checkout"], extra: "flaky: true\n" },
          login: { status: "failed", tags: ["login"] },
        },
      }),
    ),
  );
  noCatalog = await loadPackFacts(await sealCopy(await stagePack({ runId: "r2", tests: { a: { status: "passed" } } })));
});

describe("judge", () => {
  it("passes when every gate passes, and fills the whole document", () => {
    const doc = judge(pack, policy(gates(
      "{ id: some-passed, metric: totals.passed, min: 1, severity: blocking }",
      "{ id: heals, metric: metrics.self_heals, max: 3, severity: warning }",
      "{ id: has-checkout, expr: \"tests.exists(t, t.id == 'checkout')\", severity: blocking, message: checkout ran }",
    )), undefined, { evaluatedAt: AT });
    expect(doc).toMatchObject({
      result: "pass",
      evaluated_at: AT,
      evaluator: `evidence-cli ${VERSION}`,
      pack: { run_id: "r1", sha256: pack.sha256, contract: "0.1" },
      policy: { id: "release" },
      catalog: { id: "kane-cli", version: 3, source: "controller" },
      error: null,
      failed_gates: [],
      warnings: [],
      errored_gates: [],
      exit_code: 0,
    });
    expect(doc.policy.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.gates).toEqual([
      { id: "some-passed", metric: "totals.passed", where: null, op: "min", expected: 1, actual: 1, severity: "blocking", status: "pass", trust: "recomputed", message: null, error: null, stored: null },
      { id: "heals", metric: "metrics.self_heals", where: null, op: "max", expected: 3, actual: 2, severity: "warning", status: "pass", trust: "stored", message: null, error: null, stored: null },
      { id: "has-checkout", expr: "tests.exists(t, t.id == 'checkout')", where: null, op: "expr", expected: true, actual: true, severity: "blocking", status: "pass", trust: "recomputed", message: "checkout ran", error: null, stored: null },
    ]);
    expectSchemaValid(doc);
  });

  const compare: { name: string; gate: string; status: string }[] = [
    { name: "equals passes", gate: "{ id: g, metric: totals.failed, equals: 1, severity: blocking }", status: "pass" },
    { name: "equals fails", gate: "{ id: g, metric: totals.failed, equals: 0, severity: blocking }", status: "fail" },
    { name: "min fails", gate: "{ id: g, metric: pass_rate, min: 0.9, severity: blocking }", status: "fail" },
    { name: "max passes at the bound", gate: "{ id: g, metric: totals.failed, max: 1, severity: blocking }", status: "pass" },
    { name: "range passes", gate: "{ id: g, metric: pass_rate, range: [0.5, 1], severity: blocking }", status: "pass" },
    { name: "range fails", gate: "{ id: g, metric: pass_rate, range: [0.6, 1], severity: blocking }", status: "fail" },
    { name: "in passes", gate: "{ id: g, metric: run.status, in: [finalized, aborted], severity: blocking }", status: "pass" },
    { name: "in fails", gate: "{ id: g, metric: totals.tests, in: [1, 3], severity: blocking }", status: "fail" },
    { name: "where narrows", gate: "{ id: g, metric: pass_rate, where: \"'checkout' in test.tags\", min: 1, severity: blocking }", status: "pass" },
    { name: "a failed warning gate warns", gate: "{ id: g, metric: totals.failed, equals: 0, severity: warning }", status: "warn" },
    { name: "expr false fails", gate: "{ id: g, expr: \"tests.all(t, t.status == 'passed')\", severity: blocking }", status: "fail" },
    { name: "expr error errors", gate: "{ id: g, expr: \"tests[5].status == 'x'\", severity: warning }", status: "errored" },
    { name: "a catalog where that gives a non-bool errors", gate: "{ id: g, metric: metrics.failed_by_status, max: 0, severity: blocking }", status: "errored" },
    { name: "a gate where that gives a non-bool errors", gate: "{ id: g, metric: totals.failed, where: \"test.status\", max: 0, severity: blocking }", status: "errored" },
    { name: "stored mismatch errors", gate: "{ id: g, metric: metrics.flaky_rate, max: 1, severity: warning }", status: "errored" },
  ];
  it.each(compare)("$name", ({ gate, status }) => {
    const doc = judge(pack, policy(gates(gate)), undefined, { evaluatedAt: AT });
    expect(doc.gates[0].status).toBe(status);
    expectSchemaValid(doc);
  });

  it("works out result, lists and exit code from the gates", () => {
    const cases: { gates: string[]; result: string; exit: number; failed: string[]; warnings: string[]; errored: string[] }[] = [
      { gates: ["{ id: w, metric: totals.failed, equals: 0, severity: warning }"], result: "pass", exit: 0, failed: [], warnings: ["w"], errored: [] },
      { gates: ["{ id: b, metric: totals.failed, equals: 0, severity: blocking }", "{ id: w, metric: totals.failed, equals: 0, severity: warning }"], result: "fail", exit: 1, failed: ["b"], warnings: ["w"], errored: [] },
      { gates: ["{ id: b, metric: totals.failed, equals: 0, severity: blocking }", "{ id: e, metric: metrics.flaky_rate, max: 1, severity: warning }"], result: "errored", exit: 3, failed: ["b"], warnings: [], errored: ["e"] },
    ];
    for (const c of cases) {
      const doc = judge(pack, policy(gates(...c.gates)), undefined, { evaluatedAt: AT });
      expect([doc.result, doc.exit_code, doc.failed_gates, doc.warnings, doc.errored_gates]).toEqual([c.result, c.exit, c.failed, c.warnings, c.errored]);
    }
  });

  it("reports the recompute and the stored number on a mismatch", () => {
    const doc = judge(pack, policy(gates("{ id: g, metric: metrics.flaky_rate, max: 1, severity: blocking }")), undefined, { evaluatedAt: AT });
    expect(doc.gates[0]).toMatchObject({ status: "errored", actual: 0.5, stored: 0, trust: "recomputed", error: { code: "verdict.stored_mismatch" } });
  });

  it("errors a metrics.* gate on a pack with no catalog, and still judges built-ins", () => {
    const doc = judge(noCatalog, policy(gates(
      "{ id: heals, metric: metrics.self_heals, max: 3, severity: warning }",
      "{ id: all-pass, metric: totals.failed, equals: 0, severity: blocking }",
    )), undefined, { evaluatedAt: AT });
    expect(doc.catalog).toBeNull();
    expect(doc.gates.map((g) => [g.id, g.status, g.error?.code ?? null])).toEqual([
      ["heals", "errored", "verdict.catalog_missing"],
      ["all-pass", "pass", null],
    ]);
    expect(doc.result).toBe("errored");
    expectSchemaValid(doc);
  });

  const whole: { name: string; facts: () => PackFacts; text: string; code: string }[] = [
    { name: "an unfinalized pack", facts: () => ({ ...pack, status: "running" }), text: gates("{ id: g, metric: totals.failed, equals: 0, severity: blocking }"), code: "verdict.unfinalized" },
    { name: "an invalid pack", facts: () => ({ ...pack, validation: { ...pack.validation, valid: false, diagnostics: [{ code: "totals.mismatch", severity: "error", location: "run.yaml", message: "bad" }] } }), text: gates("{ id: g, metric: totals.failed, equals: 0, severity: blocking }"), code: "verdict.pack_invalid" },
    { name: "a policy that requires a catalog the pack lacks", facts: () => noCatalog, text: "policy: p\nrequires: { catalog: kane-cli }\ngates:\n  - { id: g, expr: \"true\", severity: blocking }\n", code: "policy.catalog_required" },
    { name: "a policy naming a metric the pack's catalog lacks", facts: () => pack, text: gates("{ id: g, metric: metrics.nope, max: 1, severity: blocking }"), code: "policy.unknown_metric" },
  ];
  it.each(whole)("errors the whole verdict for $name", ({ facts, text, code }) => {
    const doc = judge(facts(), policy(text), undefined, { evaluatedAt: AT });
    expect(doc).toMatchObject({ result: "errored", exit_code: 3, gates: [], error: { code } });
    expect(typeof doc.error!.message).toBe("string");
    expectSchemaValid(doc);
  });

  it("gives the same document for the same pack and policy", () => {
    const p = policy(gates("{ id: g, metric: pass_rate, min: 0.4, severity: blocking }", "{ id: h, expr: \"totals.failed == 1\", severity: blocking }"));
    expect(judge(pack, p, undefined, { evaluatedAt: AT })).toEqual(judge(pack, p, undefined, { evaluatedAt: AT }));
  });

  it("never touches the pack", async () => {
    const before = await fs.readFile(pack.target);
    judge(pack, policy(gates("{ id: g, metric: totals.failed, equals: 0, severity: blocking }")), undefined, { evaluatedAt: AT });
    expect((await fs.readFile(pack.target)).equals(before)).toBe(true);
    expect(await fs.readdir(path.dirname(pack.target))).toEqual([path.basename(pack.target)]);
  });
});

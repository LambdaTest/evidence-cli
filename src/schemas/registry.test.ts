import { describe, expect, it } from "vitest";
import { getSchemas, getToolSchema } from "./registry";
import { loadToolSchema } from "./compile";

describe("getSchemas", () => {
  it("returns the run + result schemas for 0.1/L0 with versioned $id", () => {
    const { run, result } = getSchemas("0.1", "L0");
    expect((run as any).$id).toBe("https://evidence-cli.dev/schemas/0.1/L0/run.schema.json");
    expect((result as any).$id).toBe("https://evidence-cli.dev/schemas/0.1/L0/result.schema.json");
  });

  it("throws on an unknown version", () => {
    expect(() => getSchemas("0.2", "L0")).toThrow(/version 0\.2/);
  });

  it("throws on an unknown profile", () => {
    expect(() => getSchemas("0.1", "L9")).toThrow(/profile L9/);
  });
});

describe("getToolSchema", () => {
  it.each([
    ["policy", "https://evidence-cli.dev/schemas/policy.schema.json"],
    ["metrics-catalog", "https://evidence-cli.dev/schemas/metrics-catalog.schema.json"],
    ["verdict", "https://evidence-cli.dev/schemas/verdict.schema.json"],
  ] as const)("registers %s", (id, $id) => {
    expect((getToolSchema(id) as any).$id).toBe($id);
  });

  it("throws on an unknown id", () => {
    expect(() => getToolSchema("nope" as any)).toThrow(/nope/);
  });
});

describe("policy schema", () => {
  const validate = loadToolSchema("policy");
  const cases: { name: string; doc: unknown; ok: boolean }[] = [
    {
      name: "metric gate and expr gate",
      doc: {
        policy: "release-2.x",
        requires: { catalog: "kane-cli", version: ">=1 <4" },
        gates: [
          { id: "all-pass", metric: "totals.failed", equals: 0, severity: "blocking" },
          { id: "rate", metric: "pass_rate", where: "'checkout' in test.tags", min: 0.95, severity: "warning", message: "m" },
          { id: "lcp", metric: "metrics.perf.lcp_ms", range: [0, 2500], severity: "warning" },
          { id: "status", metric: "run.status", in: ["finalized"], severity: "blocking" },
          { id: "no-flaky", expr: "tests.all(t, !t.flaky)", severity: "blocking" },
        ],
      },
      ok: true,
    },
    { name: "missing gates", doc: { policy: "p" }, ok: false },
    { name: "empty gates", doc: { policy: "p", gates: [] }, ok: false },
    { name: "unsafe policy id", doc: { policy: "../p", gates: [{ id: "g", expr: "true", severity: "blocking" }] }, ok: false },
    { name: "unknown top-level key", doc: { policy: "p", gates: [{ id: "g", expr: "true", severity: "blocking" }], extra: 1 }, ok: false },
    { name: "metric without operator", doc: { policy: "p", gates: [{ id: "g", metric: "totals.failed", severity: "blocking" }] }, ok: false },
    { name: "metric with two operators", doc: { policy: "p", gates: [{ id: "g", metric: "totals.failed", min: 0, max: 1, severity: "blocking" }] }, ok: false },
    { name: "expr with operator", doc: { policy: "p", gates: [{ id: "g", expr: "true", equals: 1, severity: "blocking" }] }, ok: false },
    { name: "expr with where", doc: { policy: "p", gates: [{ id: "g", expr: "true", where: "true", severity: "blocking" }] }, ok: false },
    { name: "metric and expr", doc: { policy: "p", gates: [{ id: "g", metric: "totals.failed", expr: "true", equals: 0, severity: "blocking" }] }, ok: false },
    { name: "bad severity", doc: { policy: "p", gates: [{ id: "g", expr: "true", severity: "fatal" }] }, ok: false },
    { name: "range of one", doc: { policy: "p", gates: [{ id: "g", metric: "pass_rate", range: [1], severity: "blocking" }] }, ok: false },
    { name: "bad version range", doc: { policy: "p", requires: { catalog: "c", version: "latest" }, gates: [{ id: "g", expr: "true", severity: "blocking" }] }, ok: false },
  ];
  it.each(cases)("$name", ({ doc, ok }) => {
    expect(validate(doc)).toBe(ok);
  });
});

describe("metrics-catalog schema", () => {
  const validate = loadToolSchema("metrics-catalog");
  const cases: { name: string; doc: unknown; ok: boolean }[] = [
    {
      name: "all four verify kinds",
      doc: {
        catalog: "kane-cli",
        version: 3,
        min_producer: "0.5.0",
        metrics: {
          credits: { type: "decimal", unit: "credits", verify: "stored", merge: "sum" },
          "heal.healed_tests": { type: "count", per_test: true, verify: { aggregate: "count", where: "has(test.adaptive_heal)" }, merge: "recompute" },
          "coverage.uncovered": { type: "count", verify: { file: "coverage/usecases.yaml", path: "rollup.aspects.strict.summary.uncovered" } },
          flaky_rate: { type: "ratio", range: [0, 1], verify: { expr: "1.0" }, merge: "recompute" },
        },
      },
      ok: true,
    },
    { name: "string version", doc: { catalog: "evidence-core", version: "0.1", metrics: {} }, ok: true },
    { name: "bad metric name", doc: { catalog: "c", version: 1, metrics: { SelfHeals: { type: "count", verify: "stored" } } }, ok: false },
    { name: "unknown type", doc: { catalog: "c", version: 1, metrics: { x: { type: "bool", verify: "stored" } } }, ok: false },
    { name: "aggregate with path and value", doc: { catalog: "c", version: 1, metrics: { x: { type: "count", verify: { aggregate: "sum", path: "a", value: "1" } } } }, ok: false },
    { name: "aggregate over a non-test file", doc: { catalog: "c", version: 1, metrics: { x: { type: "count", verify: { aggregate: "sum", over: "run.yaml", path: "a" } } } }, ok: false },
    { name: "unknown merge rule", doc: { catalog: "c", version: 1, metrics: { x: { type: "count", verify: "stored", merge: "avg" } } }, ok: false },
    { name: "unknown key", doc: { catalog: "c", version: 1, metrics: { x: { type: "count", verify: "stored", verfy: 1 } } }, ok: false },
  ];
  it.each(cases)("$name", ({ doc, ok }) => {
    expect(validate(doc)).toBe(ok);
  });
});

describe("verdict schema", () => {
  const validate = loadToolSchema("verdict");
  const base = {
    result: "fail",
    evaluated_at: "2026-10-21T10:00:00Z",
    evaluator: "evidence-cli 0.2.0",
    pack: { run_id: "r1", sha256: "a".repeat(64), contract: "0.1" },
    policy: { id: "release-2.x", sha256: "b".repeat(64) },
    catalog: { id: "kane-cli", version: 3, sha256: "c".repeat(64), source: "controller" },
    error: null,
    gates: [
      {
        id: "all-pass", metric: "totals.failed", where: null, op: "equals", expected: 0, actual: 1,
        severity: "blocking", status: "fail", trust: "recomputed", message: null, error: null, stored: null,
      },
      {
        id: "x", expr: "true", where: null, op: "expr", expected: true, actual: null,
        severity: "warning", status: "errored", trust: null, message: null,
        error: { code: "verdict.expr_error", message: "boom", hint: null }, stored: null,
      },
    ],
    failed_gates: ["all-pass"],
    warnings: [],
    errored_gates: ["x"],
    exit_code: 1,
  };
  const cases: { name: string; doc: unknown; ok: boolean }[] = [
    { name: "full verdict", doc: base, ok: true },
    { name: "directory pack, no catalog", doc: { ...base, pack: { run_id: "r1", sha256: null, contract: "0.1" }, catalog: null }, ok: true },
    { name: "exit code 2 is not a verdict", doc: { ...base, exit_code: 2 }, ok: false },
    { name: "unknown result", doc: { ...base, result: "pending" }, ok: false },
    { name: "gate with neither metric nor expr", doc: { ...base, gates: [{ ...base.gates[0], metric: undefined }] }, ok: false },
  ];
  it.each(cases)("$name", ({ doc, ok }) => {
    expect(validate(JSON.parse(JSON.stringify(doc)))).toBe(ok);
  });
});

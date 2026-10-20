import { describe, expect, it } from "vitest";
import { CORE_CATALOG, CatalogLoadError, lintCatalog, loadCatalog } from "./catalog";

describe("CORE_CATALOG", () => {
  it("is the built-in evidence-core 0.1 catalog", () => {
    expect(CORE_CATALOG.id).toBe("evidence-core");
    expect(CORE_CATALOG.version).toBe("0.1");
    expect(CORE_CATALOG.builtin).toBe(true);
  });

  it("ships the built-in names and no others", () => {
    expect(Object.keys(CORE_CATALOG.metrics).sort()).toEqual([
      "failures.count",
      "pass_rate",
      "run.duration_ms",
      "run.status",
      "steps.failed",
      "steps.skipped",
      "steps.total",
      "totals.broken",
      "totals.failed",
      "totals.passed",
      "totals.skipped",
      "totals.tests",
    ]);
  });

  it("never trusts a stored number", () => {
    for (const m of Object.values(CORE_CATALOG.metrics)) expect(m.verify.kind).not.toBe("stored");
  });

  it("marks the per-test metrics", () => {
    const perTest = Object.values(CORE_CATALOG.metrics).filter((m) => m.per_test).map((m) => m.name).sort();
    expect(perTest).toEqual([
      "pass_rate", "steps.failed", "steps.skipped", "steps.total",
      "totals.broken", "totals.failed", "totals.passed", "totals.skipped", "totals.tests",
    ]);
  });
});

const KANE = `catalog: kane-cli
version: 3
min_producer: "0.5.0"
metrics:
  credits: { type: decimal, unit: credits, verify: stored, merge: sum }
  heal.healed_tests:
    type: count
    per_test: true
    verify: { aggregate: count, where: "has(test.adaptive_heal) && test.adaptive_heal.outcome == 'healed'" }
    merge: recompute
  coverage.uncovered:
    type: count
    verify: { file: coverage/usecases.yaml, path: rollup.aspects.strict.summary.uncovered }
  flaky_rate:
    type: ratio
    range: [0, 1]
    verify: { expr: "double(size(tests.filter(t, t.flaky))) / double(totals.tests)" }
    merge: recompute
  agent.reasoning_ms:
    type: ms
    verify: { aggregate: sum, over: "tests/*/logs/timings.json", path: summary.total_reasoning_ms }
`;

describe("loadCatalog", () => {
  it("loads a producer catalog with every verify kind", () => {
    const c = loadCatalog(KANE);
    expect(c).toMatchObject({ id: "kane-cli", version: 3, builtin: false });
    expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.metrics.credits).toMatchObject({ type: "decimal", unit: "credits", verify: { kind: "stored" }, merge: "sum", per_test: false });
    expect(c.metrics["heal.healed_tests"].verify).toMatchObject({ kind: "aggregate", aggregate: "count", over: "tests/*/result.yaml" });
    expect(c.metrics["coverage.uncovered"]).toMatchObject({ verify: { kind: "file", file: "coverage/usecases.yaml" }, merge: "none" });
    expect(c.metrics.flaky_rate.verify.kind).toBe("expr");
    expect(c.metrics["agent.reasoning_ms"].verify).toMatchObject({ over: "tests/*/logs/timings.json" });
  });

  it("accepts JSON text", () => {
    expect(loadCatalog(JSON.stringify({ catalog: "x", version: "1.2", metrics: {} })).version).toBe("1.2");
  });

  it("throws CatalogLoadError carrying every diagnostic", () => {
    try {
      loadCatalog("catalog: c\nversion: 1\nmetrics:\n  pass_rate: { type: ratio, verify: stored }\n  x: { type: count, verify: { expr: 'nope +' } }\n");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CatalogLoadError);
      expect((e as CatalogLoadError).diagnostics.map((d) => d.code).sort()).toEqual(["catalog.expr", "catalog.reserved_name"]);
    }
  });
});

describe("lintCatalog", () => {
  const cases: { name: string; text: string; codes: string[] }[] = [
    { name: "bad YAML", text: "catalog: [", codes: ["catalog.parse"] },
    { name: "schema violation", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: bool, verify: stored }\n", codes: ["catalog.schema"] },
    { name: "reserved built-in name", text: "catalog: c\nversion: 1\nmetrics:\n  totals.failed: { type: count, verify: stored }\n", codes: ["catalog.reserved_name"] },
    { name: "expression does not compile", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: count, verify: { expr: 'foo == 1' } }\n", codes: ["catalog.expr"] },
    { name: "aggregate where does not compile", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: count, verify: { aggregate: count, where: 'tests.size()' } }\n", codes: ["catalog.expr"] },
    { name: "file escapes the pack", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: count, verify: { file: ../x.yaml, path: a } }\n", codes: ["catalog.path_escape"] },
    { name: "recompute on a stored metric", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: count, verify: stored, merge: recompute }\n", codes: ["catalog.merge_rule"] },
    { name: "per_test on a stored metric", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: count, verify: stored, per_test: true }\n", codes: ["catalog.schema"] },
    { name: "aggregate sum with nothing to fold", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: count, verify: { aggregate: sum } }\n", codes: ["catalog.schema"] },
    { name: "range lo > hi", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: ratio, range: [1, 0], verify: { expr: '1.0' } }\n", codes: ["catalog.schema"] },
    { name: "values on a non-enum", text: "catalog: c\nversion: 1\nmetrics:\n  x: { type: string, values: [a], verify: stored }\n", codes: ["catalog.schema"] },
  ];
  it.each(cases)("$name", ({ text, codes }) => {
    const { catalog, diagnostics } = lintCatalog(text);
    expect(catalog).toBeNull();
    for (const code of codes) expect(diagnostics.map((d) => d.code)).toContain(code);
  });

  it("prefixes locations with the given file", () => {
    const { diagnostics } = lintCatalog("catalog: c\nversion: 1\nmetrics:\n  pass_rate: { type: ratio, verify: stored }\n", { location: "meta/metrics-catalog.yaml" });
    expect(diagnostics[0].location).toBe("meta/metrics-catalog.yaml#/metrics/pass_rate");
  });
});

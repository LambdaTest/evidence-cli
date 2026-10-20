import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog";
import { checkPolicy, lintPolicy } from "./lint";
import { loadPolicy } from "./policy";

const KANE = loadCatalog(`catalog: kane-cli
version: 3
metrics:
  self_heals: { type: count, verify: stored, merge: sum }
  perf.lcp_ms: { type: ms, verify: stored }
  flaky_rate: { type: ratio, range: [0, 1], verify: { expr: "1.0" } }
  browser: { type: enum, values: [chrome, firefox], verify: stored }
  healed_tests: { type: count, per_test: true, verify: { aggregate: count } }
`);

function gates(...lines: string[]): string {
  return `policy: p\ngates:\n${lines.map((l) => `  - ${l}`).join("\n")}\n`;
}

describe("lintPolicy", () => {
  it("passes a clean policy against its catalog", () => {
    const text = `policy: release-2.x
requires: { catalog: kane-cli, version: ">=1" }
gates:
  - { id: all-pass, metric: totals.failed, equals: 0, severity: blocking }
  - { id: heals, metric: metrics.self_heals, max: 3, severity: warning }
  - { id: lcp, metric: metrics.perf.lcp_ms, range: [0, 2500], severity: warning }
  - { id: rate, metric: pass_rate, where: "'checkout' in test.tags", min: 0.95, severity: blocking }
  - { id: browser, metric: metrics.browser, in: [chrome], severity: blocking }
  - { id: status, metric: run.status, equals: finalized, severity: blocking }
  - { id: flaky, expr: "tests.filter(t, 'critical' in t.tags).all(t, !t.flaky)", severity: blocking }
`;
    expect(lintPolicy(text, { catalog: KANE })).toEqual([]);
  });

  const cases: { name: string; text: string; code: string; hint?: RegExp; message?: RegExp; severity?: string }[] = [
    { name: "unknown producer metric, with a suggestion", text: gates("{ id: heals, metric: metrics.self_heal, max: 3, severity: warning }"), code: "policy.unknown_metric", hint: /"metrics\.self_heals".*kane-cli catalog v3/ },
    { name: "unknown built-in, with a suggestion", text: gates("{ id: g, metric: totals.faild, equals: 0, severity: blocking }"), code: "policy.unknown_metric", hint: /"totals\.failed"/ },
    { name: "producer metric written without metrics.", text: gates("{ id: g, metric: self_heals, max: 1, severity: blocking }"), code: "policy.unknown_metric", hint: /metric: metrics\.self_heals/ },
    { name: "built-in written with metrics.", text: gates("{ id: rate, metric: metrics.pass_rate, min: 0.9, severity: blocking }"), code: "policy.builtin_prefixed", hint: /metric: pass_rate/ },
    { name: "equals on a ratio", text: gates("{ id: g, metric: pass_rate, equals: 1, severity: blocking }"), code: "policy.op_not_allowed", hint: /min, max, range/ },
    { name: "min on an enum", text: gates("{ id: g, metric: run.status, min: 1, severity: blocking }"), code: "policy.op_not_allowed", hint: /equals, in/ },
    { name: "non-integer threshold on a count", text: gates("{ id: g, metric: totals.failed, max: 0.5, severity: blocking }"), code: "policy.value_type", message: /integer/ },
    { name: "string threshold on a count", text: gates("{ id: g, metric: totals.failed, in: [zero], severity: blocking }"), code: "policy.value_type" },
    { name: "threshold outside the metric range", text: gates("{ id: g, metric: pass_rate, min: 95, severity: blocking }"), code: "policy.value_type", message: /\[0, 1\]/ },
    { name: "range with lo > hi", text: gates("{ id: g, metric: run.duration_ms, range: [10, 1], severity: blocking }"), code: "policy.value_type" },
    { name: "enum value not in the catalog", text: gates("{ id: g, metric: run.status, equals: done, severity: blocking }"), code: "policy.value_type", hint: /running, finalized, aborted/ },
    { name: "where on a whole-run metric", text: gates("{ id: g, metric: run.duration_ms, where: \"'x' in test.tags\", max: 10, severity: blocking }"), code: "policy.where_not_per_test", hint: /pass_rate/ },
    { name: "where that does not parse", text: gates("{ id: g, metric: pass_rate, where: \"'x' in\", min: 0.5, severity: blocking }"), code: "policy.expr_syntax" },
    { name: "where that is not a bool", text: gates("{ id: g, metric: pass_rate, where: \"size(test.tags)\", min: 0.5, severity: blocking }"), code: "policy.expr_type", message: /bool/ },
    { name: "expr that does not parse", text: gates("{ id: g, expr: \"tests.all(t,\", severity: blocking }"), code: "policy.expr_syntax" },
    { name: "expr with an unknown variable", text: gates("{ id: g, expr: \"test.flaky\", severity: blocking }"), code: "policy.expr_type", hint: /run, tests, totals, failures/ },
    { name: "expr that is not a bool", text: gates("{ id: g, expr: \"size(tests)\", severity: blocking }"), code: "policy.expr_type", message: /bool/ },
    { name: "requires a different catalog", text: `policy: p\nrequires: { catalog: other }\ngates:\n  - { id: g, expr: "true", severity: blocking }\n`, code: "policy.catalog_required", hint: /kane-cli/ },
    { name: "requires a newer catalog", text: `policy: p\nrequires: { catalog: kane-cli, version: ">=4" }\ngates:\n  - { id: g, expr: "true", severity: blocking }\n`, code: "policy.catalog_required", message: /v3/ },
  ];
  it.each(cases)("$name", ({ text, code, hint, message }) => {
    const diags = lintPolicy(text, { catalog: KANE });
    const d = diags.find((x) => x.code === code);
    expect(d, JSON.stringify(diags, null, 1)).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.line).toBeGreaterThan(0);
    if (hint) expect(d!.hint).toMatch(hint);
    if (message) expect(d!.message).toMatch(message);
  });

  it("reports every problem in one pass, structural and semantic", () => {
    const text = gates(
      "{ id: a, metric: metrics.self_heal, max: 3, severity: warning }",
      "{ id: b, metric: metrics.perf.lcp_ms, equals: 1.5, severity: warning }",
      "{ id: c, metric: metrics.pass_rate, min: 0.9, severity: blocking }",
      "{ id: c, expr: \"true\", severity: blocking, minimum: 1 }",
    );
    expect(lintPolicy(text, { catalog: KANE }).map((d) => d.code)).toEqual([
      "policy.unknown_metric",
      "policy.builtin_prefixed",
      "policy.unknown_key",
      "policy.duplicate_gate",
    ]);
  });

  it("without a catalog, checks built-ins and warns once per metrics.* gate", () => {
    const text = `policy: p\nrequires: { catalog: kane-cli }\ngates:\n  - { id: a, metric: metrics.self_heals, max: 3, severity: warning }\n  - { id: b, metric: totals.failed, equals: 0.5, severity: blocking }\n`;
    const diags = lintPolicy(text);
    expect(diags.map((d) => [d.code, d.severity])).toEqual([
      ["policy.catalog_needed", "warning"],
      ["policy.catalog_needed", "warning"],
      ["policy.value_type", "error"],
    ]);
    expect(diags[0].hint).toMatch(/--catalog/);
  });

  it("returns only the parse error when the YAML does not parse", () => {
    expect(lintPolicy("policy: [").map((d) => d.code)).toEqual(["policy.parse"]);
  });
});

describe("checkPolicy in a pack context", () => {
  it("leaves metrics.* gates to the evaluator when the pack has no catalog", () => {
    const { policy } = loadPolicy(gates("{ id: a, metric: metrics.self_heals, max: 3, severity: warning }"));
    expect(checkPolicy(policy!, { catalog: null, pack: true })).toEqual([]);
  });

  it("errors a policy that requires a catalog the pack does not carry", () => {
    const { policy } = loadPolicy(`policy: p\nrequires: { catalog: kane-cli }\ngates:\n  - { id: g, expr: "true", severity: blocking }\n`);
    const diags = checkPolicy(policy!, { catalog: null, pack: true });
    expect(diags.map((d) => [d.code, d.severity])).toEqual([["policy.catalog_required", "error"]]);
    expect(diags[0].message).toMatch(/carries no metric catalog/);
  });
});

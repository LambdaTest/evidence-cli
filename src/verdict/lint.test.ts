import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog";
import { checkPolicy, lintPolicy } from "./lint";
import { loadPolicy } from "./policy";

interface LintCase { name: string; text: string; codes: string[] }
interface LintFixture { catalogs: Record<string, string>; clean: { name: string; text: string }[]; cases: LintCase[] }

// Shared with other implementations of the lint (Test Manager checks uploaded policies with a Go port).
const FIXTURE: LintFixture = JSON.parse(readFileSync(join(__dirname, "../../fixtures/policy-lint/cases.json"), "utf-8"));
const KANE = loadCatalog(FIXTURE.catalogs["kane-cli"]);

function gates(...lines: string[]): string {
  return `policy: p\ngates:\n${lines.map((l) => `  - ${l}`).join("\n")}\n`;
}

const errorCodes = (text: string) =>
  lintPolicy(text, { catalog: KANE }).filter((d) => d.severity === "error").map((d) => d.code);

describe("lintPolicy", () => {
  it.each(FIXTURE.clean)("clean: $name", ({ text }) => {
    expect(errorCodes(text)).toEqual([]);
  });

  it.each(FIXTURE.cases)("$name", ({ text, codes }) => {
    expect([...new Set(errorCodes(text))].sort()).toEqual([...new Set(codes)].sort());
  });

  // Hint and message wording, checked here only: other implementations match codes, not prose.
  const wording: Record<string, { code: string; hint?: RegExp; message?: RegExp }> = {
    "unknown producer metric, with a suggestion": { code: "policy.unknown_metric", hint: /"metrics\.self_heals".*kane-cli catalog v3/ },
    "unknown built-in, with a suggestion": { code: "policy.unknown_metric", hint: /"totals\.failed"/ },
    "producer metric written without metrics.": { code: "policy.unknown_metric", hint: /metric: metrics\.self_heals/ },
    "built-in written with metrics.": { code: "policy.builtin_prefixed", hint: /metric: pass_rate/ },
    "equals on a ratio": { code: "policy.op_not_allowed", hint: /min, max, range/ },
    "min on an enum": { code: "policy.op_not_allowed", hint: /equals, in/ },
    "non-integer threshold on a count": { code: "policy.value_type", message: /integer/ },
    "threshold outside the metric range": { code: "policy.value_type", message: /\[0, 1\]/ },
    "enum value not in the catalog": { code: "policy.value_type", hint: /running, finalized, aborted/ },
    "where on a whole-run metric": { code: "policy.where_not_per_test", hint: /pass_rate/ },
    "where that is not a bool": { code: "policy.expr_type", message: /bool/ },
    "expr with an unknown variable": { code: "policy.expr_type", hint: /run, tests, totals, failures/ },
    "expr that is not a bool": { code: "policy.expr_type", message: /bool/ },
    "requires a different catalog": { code: "policy.catalog_required", hint: /kane-cli/ },
    "requires a newer catalog": { code: "policy.catalog_required", message: /v3/ },
  };
  it.each(Object.entries(wording))("wording: %s", (name, { code, hint, message }) => {
    const c = FIXTURE.cases.find((x) => x.name === name);
    expect(c, name).toBeDefined();
    const d = lintPolicy(c!.text, { catalog: KANE }).find((x) => x.code === code);
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.line).toBeGreaterThan(0);
    if (hint) expect(d!.hint).toMatch(hint);
    if (message) expect(d!.message).toMatch(message);
  });

  it("reports every problem in one pass, in line order", () => {
    const c = FIXTURE.cases.find((x) => x.name === "reports every problem in one pass, structural and semantic")!;
    expect(lintPolicy(c.text, { catalog: KANE }).map((d) => d.code)).toEqual([
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

  it("finds a producer metric named constructor, and hints the prefix when it is written bare", () => {
    const catalog = loadCatalog("catalog: c\nversion: 1\nmetrics:\n  constructor: { type: count, verify: stored }\n");
    expect(lintPolicy(gates("{ id: g, metric: metrics.constructor, max: 1, severity: blocking }"), { catalog })).toEqual([]);
    const diags = lintPolicy(gates("{ id: g, metric: constructor, max: 1, severity: blocking }"), { catalog });
    expect(diags.map((d) => d.code)).toEqual(["policy.unknown_metric"]);
    expect(diags[0].hint).toMatch(/metric: metrics\.constructor/);
  });

  it("does not hint a prefix for a prototype name the catalog does not define", () => {
    const diags = lintPolicy(gates("{ id: g, metric: toString, max: 1, severity: blocking }"), { catalog: KANE });
    expect(diags[0].hint).not.toMatch(/metrics\.toString/);
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

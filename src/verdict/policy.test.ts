import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { loadPolicy, satisfiesVersion } from "./policy";

const GOOD = `policy: release-2.x
requires:
  catalog: kane-cli
  version: ">=1"
gates:
  - { id: all-pass, metric: totals.failed, equals: 0, severity: blocking }
  - id: checkout-pass-rate
    metric: pass_rate
    where: "'checkout' in test.tags"
    min: 0.95
    severity: warning
    message: checkout must stay green
  - id: no-flaky
    expr: "tests.all(t, !t.flaky)"
    severity: blocking
`;

describe("loadPolicy", () => {
  it("loads a policy with metric and expression gates", () => {
    const { policy, diagnostics } = loadPolicy(GOOD);
    expect(diagnostics).toEqual([]);
    expect(policy).not.toBeNull();
    expect(policy!.id).toBe("release-2.x");
    expect(policy!.requires).toEqual({ catalog: "kane-cli", version: ">=1" });
    expect(policy!.sha256).toBe(createHash("sha256").update(GOOD, "utf8").digest("hex"));
    expect(policy!.gates.map((g) => [g.id, g.metric ?? g.expr, g.op, g.expected, g.severity, g.line])).toEqual([
      ["all-pass", "totals.failed", "equals", 0, "blocking", 6],
      ["checkout-pass-rate", "pass_rate", "min", 0.95, "warning", 7],
      ["no-flaky", "tests.all(t, !t.flaky)", undefined, undefined, "blocking", 13],
    ]);
    expect(policy!.gates[1]).toMatchObject({ where: "'checkout' in test.tags", message: "checkout must stay green" });
  });

  const cases: { name: string; text: string; code: string; line?: number; hint?: RegExp; message?: RegExp }[] = [
    { name: "bad YAML", text: "policy: p\ngates: [\n", code: "policy.parse", line: 3 },
    { name: "not a mapping", text: "- a\n- b\n", code: "policy.schema", line: 1 },
    { name: "missing gates", text: "policy: p\n", code: "policy.schema", message: /gates/ },
    { name: "unknown top-level key", text: "policy: p\ngate:\n  - { id: g, expr: 'true', severity: blocking }\n", code: "policy.unknown_key", line: 2, hint: /"gates"/ },
    { name: "unknown gate key", text: "policy: p\ngates:\n  - id: g\n    metric: pass_rate\n    minimum: 0.9\n    severity: blocking\n", code: "policy.unknown_key", line: 5, hint: /"min"/ },
    { name: "metric gate without operator", text: "policy: p\ngates:\n  - { id: g, metric: pass_rate, severity: blocking }\n", code: "policy.schema", line: 3, message: /one operator/ },
    { name: "metric gate with two operators", text: "policy: p\ngates:\n  - { id: g, metric: pass_rate, min: 0, max: 1, severity: blocking }\n", code: "policy.schema", message: /min, max/ },
    { name: "both metric and expr", text: "policy: p\ngates:\n  - { id: g, metric: pass_rate, expr: 'true', min: 0, severity: blocking }\n", code: "policy.schema", message: /both/ },
    { name: "neither metric nor expr", text: "policy: p\ngates:\n  - { id: g, severity: blocking }\n", code: "policy.schema", message: /"metric" or "expr"/ },
    { name: "expr gate with an operator", text: "policy: p\ngates:\n  - { id: g, expr: 'true', equals: 1, severity: blocking }\n", code: "policy.schema", message: /no operator/ },
    { name: "bad severity", text: "policy: p\ngates:\n  - { id: g, expr: 'true', severity: fatal }\n", code: "policy.schema", line: 3, message: /blocking, warning/ },
    { name: "missing severity", text: "policy: p\ngates:\n  - { id: g, expr: 'true' }\n", code: "policy.schema", message: /severity/ },
    { name: "unsafe policy id", text: "policy: ../x\ngates:\n  - { id: g, expr: 'true', severity: blocking }\n", code: "policy.schema", line: 1 },
    { name: "duplicate gate ids", text: "policy: p\ngates:\n  - { id: g, expr: 'true', severity: blocking }\n  - { id: g, expr: 'false', severity: blocking }\n", code: "policy.duplicate_gate", line: 4, message: /line 3/ },
  ];
  it.each(cases)("$name", ({ text, code, line, hint, message }) => {
    const { diagnostics } = loadPolicy(text);
    const d = diagnostics.find((x) => x.code === code);
    expect(d, JSON.stringify(diagnostics)).toBeDefined();
    expect(d!.severity).toBe("error");
    if (line !== undefined) expect(d!.line).toBe(line);
    if (hint) expect(d!.hint).toMatch(hint);
    if (message) expect(d!.message).toMatch(message);
  });

  it("reports every structural problem at once", () => {
    const text = "policy: p\nextra: 1\ngates:\n  - { id: a, metric: pass_rate, severity: blocking }\n  - { id: a, expr: 'true', severity: loud }\n";
    const codes = loadPolicy(text).diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual(["policy.duplicate_gate", "policy.schema", "policy.schema", "policy.unknown_key"]);
  });

  it("still returns the well-formed gates when some are malformed", () => {
    const { policy } = loadPolicy("policy: p\ngates:\n  - { id: ok, expr: 'true', severity: blocking }\n  - 7\n");
    expect(policy!.gates.map((g) => g.id)).toEqual(["ok"]);
  });

  it("uses the source name in locations", () => {
    const { diagnostics } = loadPolicy("policy: p\ngates:\n  - { id: g, expr: 'true', severity: loud }\n", { source: "release.yaml" });
    expect(diagnostics[0].location).toBe("release.yaml#/gates/0/severity");
  });
});

describe("satisfiesVersion", () => {
  const cases: { version: number | string; range: string; ok: boolean }[] = [
    { version: 3, range: ">=1", ok: true },
    { version: 3, range: ">=1 <3", ok: false },
    { version: 3, range: "3", ok: true },
    { version: 3, range: "=3", ok: true },
    { version: "0.1", range: ">=0.1", ok: true },
    { version: "0.10", range: ">0.9", ok: true },
    { version: "1.2.3", range: "<1.2", ok: false },
    { version: 2, range: "<=2 >1", ok: true },
  ];
  it.each(cases)("$version satisfies $range: $ok", ({ version, range, ok }) => {
    expect(satisfiesVersion(version, range)).toBe(ok);
  });
});

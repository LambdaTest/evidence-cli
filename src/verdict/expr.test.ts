import { describe, expect, it } from "vitest";
import { compileExpr, evalExpr, ExprEvalError, makeFacts, EXPR_LIMITS } from "./expr";
import type { Compiled, ExprEnv } from "./expr";

function compiled(src: string, env: ExprEnv = "pack"): Compiled {
  const c = compileExpr(src, env);
  if (!("run" in c)) throw new Error(`did not compile: ${c.message}`);
  return c;
}

const packVars = {
  run: { run_id: "r1", started: "2026-07-08T08:00:00Z", ended: "2026-07-08T09:01:00.250Z" },
  tests: [
    { id: "checkout", status: "passed", tags: ["checkout", "critical"], flaky: false, duration_ms: 1200, steps: [] },
    { id: "login", status: "failed", tags: ["login"], flaky: true, duration_ms: 30.5, steps: [] },
    { id: "search", status: "skipped", tags: [], flaky: false, duration_ms: 10, steps: [] },
  ],
  totals: { tests: 3n, passed: 1n, failed: 1n, broken: 0n, skipped: 1n },
  failures: [],
};

describe("evalExpr — pack context", () => {
  const cases: { src: string; want: unknown }[] = [
    { src: "tests.filter(t, 'critical' in t.tags).all(t, !t.flaky)", want: true },
    { src: "tests.exists(t, t.status == 'failed')", want: true },
    { src: "tests.exists_one(t, t.flaky)", want: true },
    { src: "tests.map(t, t.id)", want: ["checkout", "login", "search"] },
    { src: "double(size(tests.filter(t, t.flaky))) / double(totals.tests)", want: 1 / 3 },
    { src: "totals.failed == 1", want: true },
    { src: "totals.failed > 0.5", want: true },
    { src: "sum(tests.map(t, t.duration_ms))", want: 1240.5 },
    { src: "sum([1, 2, 3])", want: 6 },
    { src: "sum([])", want: 0 },
    { src: "mean(tests.map(t, t.duration_ms))", want: 413.5 },
    { src: "mean([1, 2])", want: 1.5 },
    { src: "percentile(tests.map(t, t.duration_ms), 50)", want: 30.5 },
    { src: "percentile(tests.map(t, t.duration_ms), 90.0)", want: 1200 },
    { src: "percentile([5, 1, 3], 0)", want: 1 },
    { src: "double((timestamp(run.ended) - timestamp(run.started)).getMilliseconds())", want: 3660250 },
  ];
  it.each(cases)("$src", ({ src, want }) => {
    expect(evalExpr(compiled(src), makeFacts(packVars))).toEqual(want);
  });

  it("returns the same value for the same facts", () => {
    const c = compiled("tests.filter(t, t.duration_ms > 20.0).map(t, t.id)");
    const facts = makeFacts(packVars);
    expect(evalExpr(c, facts)).toEqual(evalExpr(c, facts));
  });
});

describe("evalExpr — test context", () => {
  const test = { id: "checkout", status: "passed", tags: ["checkout"], flaky: false, steps: [{ id: "a", status: "failed" }] };
  const cases: { src: string; want: unknown }[] = [
    { src: "'checkout' in test.tags", want: true },
    { src: "test.status == 'failed'", want: false },
    { src: "size(test.steps.filter(s, s.status == 'failed'))", want: 1 },
    { src: "has(test.adaptive_heal)", want: false },
    { src: "file.status", want: "passed" },
  ];
  it.each(cases)("$src", ({ src, want }) => {
    expect(evalExpr(compiled(src, "test"), makeFacts({ test, file: test, run: packVars.run }))).toEqual(want);
  });
  it("keeps a __proto__ key in the facts as a plain key", () => {
    const file = JSON.parse('{"__proto__": {"a": 1}, "b": 2}');
    const facts = makeFacts({ test, file, run: packVars.run });
    expect(evalExpr(compiled("'__proto__' in file && !has(file.a)", "test"), facts)).toBe(true);
    expect(evalExpr(compiled("file", "test"), facts)).toEqual(file);
  });
});

describe("evalExpr — errors", () => {
  const cases: { name: string; src: string; vars?: Record<string, unknown>; match: RegExp }[] = [
    { name: "missing key", src: "tests[0].nope == 1", match: /nope/ },
    { name: "mean of an empty list", src: "mean([])", match: /empty list/ },
    { name: "percentile of an empty list", src: "percentile([], 50)", match: /empty list/ },
    { name: "percentile out of range", src: "percentile([1, 2], 101)", match: /\[0, 100\]/ },
    { name: "division by zero (int)", src: "1 / 0", match: /division by zero/ },
    { name: "non-finite double", src: "double(totals.failed) / 0.0", match: /not a finite number/ },
    { name: "mixed int and double in sum", src: "sum([dyn(1), dyn(2.5)])", match: /mixes int and double/ },
  ];
  it.each(cases)("$name", ({ src, match }) => {
    const c = compiled(src);
    try {
      evalExpr(c, makeFacts(packVars));
      expect.unreachable("expected an evaluation error");
    } catch (e) {
      expect(e).toBeInstanceOf(ExprEvalError);
      expect((e as ExprEvalError).code).toBe("verdict.expr_error");
      expect((e as Error).message).toMatch(match);
    }
  });

  it("stops a nested comprehension at the cost limit", () => {
    const tests = Array.from({ length: 2000 }, (_, i) => ({ id: `t${i}`, status: "passed", tags: [] }));
    const c = compiled("tests.all(a, tests.all(b, a.status == b.status))");
    expect(() => evalExpr(c, makeFacts({ ...packVars, tests }))).toThrow(/cost limit/);
  });

  it.each([
    ["a list literal", `[${Array.from({ length: 60 }, (_, i) => i).join(",")}]`],
    ["a list mapped from the facts", "tests.map(t, t.id)"],
  ])("stops nested loops over %s, which the facts' list meter does not see, at the step limit", (_name, list) => {
    const tests = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, status: "passed", tags: [] }));
    const c = compiled(`[${list}].all(l, l.all(a, l.all(b, l.all(c, l.all(d, true)))))`);
    const started = Date.now();
    expect(() => evalExpr(c, makeFacts({ ...packVars, tests }))).toThrow(/cost limit exceeded \(5000000 steps\)/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("resets the cost budget for every evaluation", () => {
    const tests = Array.from({ length: 900 }, (_, i) => ({ id: `t${i}`, status: "passed", tags: [] }));
    const c = compiled("tests.all(a, tests.exists(b, b.status == a.status))");
    const facts = makeFacts({ ...packVars, tests });
    expect(evalExpr(c, facts)).toBe(true);
    expect(evalExpr(c, facts)).toBe(true);
  });
});

describe("compileExpr", () => {
  it("reports the result type", () => {
    expect((compiled("totals.failed == 0") as Compiled).type).toBe("bool");
    expect((compiled("sum([1.0])") as Compiled).type).toBe("double");
  });

  const cases: { name: string; src: string; env: ExprEnv; code: string; match: RegExp }[] = [
    { name: "syntax error", src: "tests.filter(", env: "pack", code: "policy.expr_syntax", match: /column 14/ },
    { name: "unknown variable", src: "foo == 1", env: "pack", code: "policy.expr_type", match: /foo/ },
    { name: "test var outside test context", src: "test.status == 'x'", env: "pack", code: "policy.expr_type", match: /test/ },
    { name: "operator type mismatch", src: "'a' + 1", env: "pack", code: "policy.expr_type", match: /string \+ int/ },
    { name: "int totals divided by a double", src: "totals.passed / 2.0", env: "pack", code: "policy.expr_type", match: /int \/ double/ },
    { name: "too many AST nodes", src: Array(EXPR_LIMITS.maxAstNodes).fill("1").join(" + "), env: "pack", code: "policy.expr_syntax", match: /maxAstNodes/ },
  ];
  it.each(cases)("$name", ({ src, env, code, match }) => {
    const d = compileExpr(src, env);
    expect("run" in d).toBe(false);
    expect(d).toMatchObject({ code, severity: "error" });
    expect((d as { message: string }).message).toMatch(match);
  });

  it("names the variables a context offers in the hint", () => {
    const d = compileExpr("foo", "test") as { hint?: string };
    expect(d.hint).toMatch(/test, file, run/);
  });
});

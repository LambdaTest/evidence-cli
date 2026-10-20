import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonReporter, HumanReporter } from "./reporter";
import type { Reporter } from "./reporter";
import type { MergeReport, ValidationReport } from "../contract";
import type { VerdictDoc } from "../verdict/evaluate";

const REPORT: ValidationReport = {
  valid: false,
  profile: "L0",
  version: "0.1",
  status: "finalized",
  diagnostics: [
    { code: "totals.mismatch", severity: "error", location: "run.yaml#/totals/passed", message: "boom" },
  ],
};

function capture(fn: () => void): string {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    out += String(c);
    return true;
  });
  fn();
  spy.mockRestore();
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe("reporters", () => {
  it("JsonReporter emits the exact report object", () => {
    const out = capture(() => new JsonReporter().validation(REPORT));
    expect(JSON.parse(out)).toEqual(REPORT);
  });

  it("HumanReporter (non-TTY) emits plain ASCII without the fancy glyph", () => {
    const out = capture(() => new HumanReporter(false).validation(REPORT));
    expect(out).toContain("totals.mismatch");
    expect(out).toContain("invalid");
    // plain marker, not the fancy glyph
    expect(out).toContain("x ");
    expect(out).not.toContain("✗");
  });

  it("HumanReporter (TTY) uses the ✗ glyph", () => {
    const out = capture(() => new HumanReporter(true).validation(REPORT));
    expect(out).toContain("✗");
  });

  it("HumanReporter names the folder for nest and split outcomes", () => {
    const merged: MergeReport = {
      packs: { eligible: ["a", "b", "c"], skipped: [] },
      tests: {
        merged: 2,
        collisions: [
          { test: "checkout", winner: "b", rule: "tests.identity.on_same=nest", action: "nest", folder: "checkout" },
          { test: "checkout", winner: "c", rule: "tests.identity.on_different=split", action: "split", folder: "checkout-1" },
          { test: "login", winner: "a", rule: "tests.on_collision=prefer_first" },
        ],
        discarded: [],
      },
      output: { path: "/out/m.evidence", runId: "nightly", finalized: false },
    };
    const out = capture(() => new HumanReporter(false).merge(merged));
    expect(out).toContain("collision checkout: nested into checkout, latest b [tests.identity.on_same=nest]");
    expect(out).toContain("collision checkout: split into checkout-1 [tests.identity.on_different=split]");
    expect(out).toContain("collision login: winner a [tests.on_collision=prefer_first]"); // unchanged
  });

  it("HumanReporter surfaces the pack's current status", () => {
    const out = capture(() => new HumanReporter(false).validation(REPORT));
    expect(out).toContain("finalized");
  });

  describe("verdicts and lint", () => {
    const DOC: VerdictDoc = {
      result: "fail",
      evaluated_at: "2026-10-21T00:00:00Z",
      evaluator: "evidence-cli 0.2.0",
      pack: { run_id: "r1", sha256: null, contract: "0.1" },
      policy: { id: "release", sha256: "a".repeat(64) },
      catalog: null,
      error: null,
      gates: [
        { id: "ok", metric: "totals.tests", where: null, op: "min", expected: 1, actual: 2, severity: "blocking", status: "pass", trust: "recomputed", message: null, error: null, stored: null },
        { id: "all-pass", metric: "totals.failed", where: null, op: "equals", expected: 0, actual: 1, severity: "blocking", status: "fail", trust: "recomputed", message: "no failures", error: null, stored: null },
        { id: "heals", metric: "metrics.x", where: null, op: "max", expected: 1, actual: null, severity: "warning", status: "errored", trust: null, message: null, error: { code: "verdict.catalog_missing", message: "no catalog", hint: null }, stored: null },
      ],
      failed_gates: ["all-pass"],
      warnings: [],
      errored_gates: ["heals"],
      exit_code: 1,
    };

    it("JsonReporter emits the verdict documents", () => {
      const reporter: Reporter = new JsonReporter();
      expect(JSON.parse(capture(() => reporter.verdicts([DOC], ["/x/release.verdict.json"])))).toEqual([DOC]);
    });

    it("HumanReporter lists the failing and errored gates and the file", () => {
      const out = capture(() => new HumanReporter(false).verdicts([DOC], ["/x/release.verdict.json"]));
      expect(out).toContain("release: fail — 3 gate(s): 1 pass, 1 fail, 0 warn, 1 errored -> /x/release.verdict.json");
      expect(out).toContain("all-pass: totals.failed equals 0, actual 1");
      expect(out).toContain("no failures");
      expect(out).toContain("heals: metrics.x errored — no catalog [verdict.catalog_missing]");
      expect(out).not.toContain(" ok: ");
    });

    it("HumanReporter prints a whole-policy error with its hint", () => {
      const doc = { ...DOC, result: "errored" as const, gates: [], error: { code: "verdict.unfinalized", message: "not sealed", hint: "run evidence finalize first" } };
      const out = capture(() => new HumanReporter(false).verdicts([doc], []));
      expect(out).toContain("release: errored — not sealed [verdict.unfinalized]");
      expect(out).toContain("-> run evidence finalize first");
    });

    it("HumanReporter lists lint problems with line and hint", () => {
      const out = capture(() =>
        new HumanReporter(false).lint([
          { source: "p.yaml", valid: false, diagnostics: [{ code: "policy.unknown_metric", severity: "error", location: "p.yaml#/gates/0/metric", message: 'gates[0] "g": unknown metric "x"', hint: 'did you mean "y"?', line: 4 }] },
          { source: "q.yaml", valid: true, diagnostics: [] },
        ]),
      );
      expect(out).toContain("p.yaml — 1 problem(s)");
      expect(out).toContain('line 4: gates[0] "g": unknown metric "x" [policy.unknown_metric]');
      expect(out).toContain('-> did you mean "y"?');
      expect(out).toContain("q.yaml — no problems");
    });
  });
});

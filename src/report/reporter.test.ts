import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonReporter, HumanReporter } from "./reporter";
import type { MergeReport, ValidationReport } from "../contract";

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
});

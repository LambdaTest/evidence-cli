import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonReporter, HumanReporter } from "./reporter";
import type { ValidationReport } from "../contract";

const REPORT: ValidationReport = {
  valid: false,
  profile: "L0",
  version: "0.1",
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
});

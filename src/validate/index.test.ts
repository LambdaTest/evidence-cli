import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { validate } from "./index";
import { Codes } from "../contract";

const FIX = path.resolve(__dirname, "../../fixtures");

describe("validate — version gate & schema", () => {
  it("rejects a 0.2 pack with version.unsupported and halts (no schema noise)", async () => {
    const report = await validate(path.join(FIX, "invalid-L0/version-0.2.evidence"));
    expect(report.valid).toBe(false);
    const codes = report.diagnostics.map((d) => d.code);
    expect(codes).toContain(Codes.VERSION_UNSUPPORTED);
    expect(codes).not.toContain(Codes.SCHEMA); // halted before schema pass
  });

  it("flags a missing required field as a schema error (not a version error)", async () => {
    const report = await validate(path.join(FIX, "invalid-L0/missing-status.evidence"));
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some((d) => d.code === Codes.SCHEMA)).toBe(true);
  });

  it("reports MANIFEST_MISSING when there is no run.yaml", async () => {
    const report = await validate(path.join(FIX, "valid-L0/smoke.evidence/tests"));
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some((d) => d.code === Codes.MANIFEST_MISSING)).toBe(true);
  });
});

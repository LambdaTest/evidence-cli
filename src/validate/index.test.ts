import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { validate } from "./index";
import { Codes } from "../contract";

const FIX = path.resolve(__dirname, "../../fixtures");

// Fixture-pack conformance cases (valid/invalid + expected codes) live in the
// data-driven corpus at src/conformance/. This file keeps only non-pack edge
// cases — inputs that are not a real <name>.evidence pack and therefore carry no
// expectation sidecar.
describe("validate — non-pack edge cases", () => {
  it("reports MANIFEST_MISSING when the target has no top-level run.yaml", async () => {
    // tests/ is a directory inside a pack, not a pack: it has no run.yaml anchor.
    const report = await validate(path.join(FIX, "valid-L0/smoke.evidence/tests"));
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some((d) => d.code === Codes.MANIFEST_MISSING)).toBe(true);
  });
});

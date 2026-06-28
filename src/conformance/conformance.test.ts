import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { validate } from "../validate";
import type { ValidationReport } from "../contract";
import { discoverFixtures, toZip, type Fixture } from "./harness";

const FIX = path.resolve(__dirname, "../../fixtures");
const ROOTS = [path.join(FIX, "valid-L0"), path.join(FIX, "invalid-L0")];

const fixtures = discoverFixtures(ROOTS);
const cases = fixtures.map((f) => [f.name, f] as const);

function errorCodes(report: ValidationReport): string[] {
  return report.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
}

function warningCodes(report: ValidationReport): string[] {
  return report.diagnostics.filter((d) => d.severity === "warning").map((d) => d.code);
}

/** Stable comparison key: validity + the sorted, de-duplicated set of codes. */
function outcome(report: ValidationReport): { valid: boolean; codes: string[] } {
  const codes = [...new Set(report.diagnostics.map((d) => d.code))].sort();
  return { valid: report.valid, codes };
}

function assertFixture(f: Fixture, report: ValidationReport): void {
  expect(report.valid, `${f.name}: expected valid=${f.expected.valid}`).toBe(f.expected.valid);

  const errs = errorCodes(report);
  for (const code of f.expected.errors) {
    expect(errs, `${f.name}: expected error code "${code}"`).toContain(code);
  }

  const warns = warningCodes(report);
  for (const code of f.expected.warnings) {
    expect(warns, `${f.name}: expected warning code "${code}"`).toContain(code);
  }

  for (const code of f.expected.notErrors) {
    expect(errs, `${f.name}: must NOT contain "${code}"`).not.toContain(code);
  }
}

describe("L0 conformance corpus", () => {
  it("discovers at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(cases)("%s — directory form", async (_name, f) => {
    assertFixture(f, await validate(f.packDir));
  });

  it.each(cases)("%s — sealed-zip form (identical outcome)", async (_name, f) => {
    const zipPath = await toZip(f.packDir);
    try {
      const zipReport = await validate(zipPath);
      const dirReport = await validate(f.packDir);
      assertFixture(f, zipReport);
      // decision 0028: dir and zip resolve to the same valid + code set
      expect(outcome(zipReport)).toEqual(outcome(dirReport));
    } finally {
      await fs.rm(path.dirname(zipPath), { recursive: true, force: true });
    }
  });
});

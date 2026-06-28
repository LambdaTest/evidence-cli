import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { validate } from "./index";
import { Codes } from "../contract";

const FIX = path.resolve(__dirname, "../../fixtures");

async function codesFor(rel: string): Promise<string[]> {
  const r = await validate(path.join(FIX, rel));
  return r.diagnostics.map((d) => d.code);
}

describe("validate — cross-checks", () => {
  it("passes the finalized smoke pack with zero errors", async () => {
    const r = await validate(path.join(FIX, "valid-L0/smoke.evidence"));
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("flags totals that disagree with the rolled-up verdicts", async () => {
    expect(await codesFor("invalid-L0/totals-mismatch.evidence")).toContain(Codes.TOTALS_MISMATCH);
  });

  it("flags a definition.path that escapes the test directory", async () => {
    expect(await codesFor("invalid-L0/path-escape.evidence")).toContain(Codes.DEFINITION_PATH_ESCAPE);
  });

  it("flags colliding step ordinals", async () => {
    expect(await codesFor("invalid-L0/ordinal-collision.evidence")).toContain(Codes.ORDINAL_COLLISION);
  });

  it("flags a definition.sha256 that does not match the file", async () => {
    expect(await codesFor("invalid-L0/hash-mismatch.evidence")).toContain(Codes.HASH_MISMATCH);
  });

  it("flags ended earlier than started on a finalized pack", async () => {
    expect(await codesFor("invalid-L0/ended-before-started.evidence")).toContain(Codes.ENDED_BEFORE_STARTED);
  });
});

import { describe, expect, it } from "vitest";
import { loadSchemas } from "./compile";

describe("loadSchemas", () => {
  it("accepts a minimal valid run.yaml object", () => {
    const { run } = loadSchemas("0.1", "L0");
    const ok = run({
      evidence: "0.1",
      run_id: "r1",
      status: "running",
      title: "t",
      started: "2026-06-28T09:00:00Z",
    });
    expect(ok).toBe(true);
  });

  it("rejects a run.yaml missing required fields", () => {
    const { run } = loadSchemas("0.1", "L0");
    const ok = run({ evidence: "0.1" });
    expect(ok).toBe(false);
    expect(run.errors && run.errors.length).toBeGreaterThan(0);
  });

  it("requires ended+totals once finalized (conditional schema)", () => {
    const { run } = loadSchemas("0.1", "L0");
    const ok = run({
      evidence: "0.1",
      run_id: "r1",
      status: "finalized",
      title: "t",
      started: "2026-06-28T09:00:00Z",
    });
    expect(ok).toBe(false);
  });
});

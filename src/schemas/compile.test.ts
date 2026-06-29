import { describe, expect, it } from "vitest";
import { loadSchemas, loadL1Schemas } from "./compile";

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

describe("loadL1Schemas", () => {
  it("accepts a logs/meta.yaml with at least one fully-declared log", () => {
    const { logsMeta } = loadL1Schemas("0.1");
    expect(
      logsMeta({ logs: [{ name: "console", file: "console.ndjson", format: "ndjson" }] }),
    ).toBe(true);
  });

  it("rejects an empty logs list and missing entry fields", () => {
    const { logsMeta } = loadL1Schemas("0.1");
    expect(logsMeta({ logs: [] })).toBe(false);
    expect(logsMeta({ logs: [{ name: "x" }] })).toBe(false);
  });

  it("accepts any non-empty format string (open vocabulary)", () => {
    const { logsMeta } = loadL1Schemas("0.1");
    expect(
      logsMeta({ logs: [{ name: "trace", file: "trace.csv", format: "csv" }] }),
    ).toBe(true);
  });

  it("requires url on video.yaml", () => {
    const { video } = loadL1Schemas("0.1");
    expect(video({ url: "https://store/v.mp4" })).toBe(true);
    expect(video({})).toBe(false);
  });
});

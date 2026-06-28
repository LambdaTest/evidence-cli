import { describe, expect, it } from "vitest";
import { getSchemas } from "./registry";

describe("getSchemas", () => {
  it("returns the run + result schemas for 0.1/L0 with versioned $id", () => {
    const { run, result } = getSchemas("0.1", "L0");
    expect((run as any).$id).toBe("https://evidence-cli.dev/schemas/0.1/L0/run.schema.json");
    expect((result as any).$id).toBe("https://evidence-cli.dev/schemas/0.1/L0/result.schema.json");
  });

  it("throws on an unknown version", () => {
    expect(() => getSchemas("0.2", "L0")).toThrow(/version 0\.2/);
  });

  it("throws on an unknown profile", () => {
    expect(() => getSchemas("0.1", "L9")).toThrow(/profile L9/);
  });
});

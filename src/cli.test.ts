import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const FIX = path.join(ROOT, "fixtures");

interface Run {
  status: number;
  stdout: string;
}

function run(args: string[]): Run {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8" });
    return { status: 0, stdout };
  } catch (e: any) {
    return { status: e.status ?? 1, stdout: (e.stdout ?? "").toString() };
  }
}

describe("evidence CLI", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  }, 120_000);

  it("exits 0 on the valid smoke pack", () => {
    const r = run(["validate", path.join(FIX, "0.1/L0/valid/smoke.evidence"), "--profile", "L0"]);
    expect(r.status).toBe(0);
  });

  it("exits 1 on an invalid pack and --json emits the report", () => {
    const r = run(["validate", path.join(FIX, "0.1/L0/invalid/totals-mismatch.evidence"), "--json"]);
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some((d: any) => d.code === "totals.mismatch")).toBe(true);
  });

  it("exits 2 (usage) when finalize is given a non-directory", () => {
    const r = run(["finalize", path.join(FIX, "0.1/L0/valid/smoke.evidence/run.yaml")]);
    expect(r.status).toBe(2);
  });
});

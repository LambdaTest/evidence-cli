import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stagePack, sealCopy } from "./merge/testkit";

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

  it("merge: exits 0, --json emits the MergeReport, output validates", async () => {
    const a = await sealCopy(await stagePack({ runId: "a", tests: { login: {} } }));
    const b = await sealCopy(await stagePack({ runId: "b", tests: { checkout: {} } }));
    const out = path.join(path.dirname(a), "m.evidence");
    const r = run(["merge", a, b, "--run-id", "m1", "-o", out, "--json"]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.output.runId).toBe("m1");
    expect(report.tests.merged).toBe(2);
    const v = run(["validate", out, "--profile", "L0"]);
    expect(v.status).toBe(0);
  });

  it("merge: exits 2 without --run-id", async () => {
    const a = await sealCopy(await stagePack({ runId: "a" }));
    const out = path.join(path.dirname(a), "m2.evidence");
    const r = run(["merge", a, "-o", out]);
    expect(r.status).toBe(2);
  });

  it("merge: exits 1 on default-collision abort", async () => {
    const a = await sealCopy(await stagePack({ runId: "a", tests: { checkout: {} } }));
    const b = await sealCopy(await stagePack({ runId: "b", tests: { checkout: {} } }));
    const out = path.join(path.dirname(a), "m3.evidence");
    const r = run(["merge", a, b, "--run-id", "m3", "-o", out]);
    expect(r.status).toBe(1);
  });

  describe("verdict", () => {
    async function writeTmp(name: string, text: string): Promise<string> {
      const p = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evi-cli-verdict-")), name);
      await fs.writeFile(p, text);
      return p;
    }
    const PASS = "policy: smoke\ngates:\n  - { id: some-tests, metric: totals.tests, min: 1, severity: blocking }\n";
    const FAIL = "policy: strict\ngates:\n  - { id: all-pass, metric: totals.failed, equals: 0, severity: blocking }\n";

    it("writes <policy-id>.verdict.json beside the pack and exits 1 on a failed policy", async () => {
      const pack = await sealCopy(await stagePack({ runId: "a", tests: { checkout: { status: "failed" } } }));
      const before = await fs.readFile(pack);
      const r = run(["verdict", pack, "--policy", await writeTmp("p.yaml", PASS), "--policy", await writeTmp("s.yaml", FAIL), "--json"]);
      expect(r.status).toBe(1);
      const docs = JSON.parse(r.stdout);
      expect(docs.map((d: any) => [d.policy.id, d.result])).toEqual([["smoke", "pass"], ["strict", "fail"]]);
      const written = JSON.parse(await fs.readFile(path.join(path.dirname(pack), "strict.verdict.json"), "utf8"));
      expect(written).toEqual(docs[1]);
      expect((await fs.readFile(pack)).equals(before)).toBe(true);
    });

    it("exits 0 when every policy passes, writing into -o", async () => {
      const pack = await sealCopy(await stagePack({ runId: "a" }));
      const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evi-cli-out-")), "verdicts");
      const r = run(["verdict", pack, "--policy", await writeTmp("p.yaml", PASS), "-o", out]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("smoke: pass");
      expect(await fs.readdir(out)).toEqual(["smoke.verdict.json"]);
    });

    it("exits 3 when a policy errors (an unfinalized pack)", async () => {
      const live = await stagePack({ runId: "live" });
      const out = await fs.mkdtemp(path.join(os.tmpdir(), "evi-cli-out-"));
      const r = run(["verdict", live, "--policy", await writeTmp("p.yaml", PASS), "-o", out, "--json"]);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout)[0].error.code).toBe("verdict.unfinalized");
    });

    it("--lint exits 1 and lists every problem, 0 when clean", async () => {
      const bad = await writeTmp("bad.yaml", "policy: p\ngates:\n  - { id: g, metric: metrics.self_heal, max: 1, severity: blocking }\n  - { id: h, metric: pass_rate, equals: 1, severity: blocking }\n");
      const catalog = await writeTmp("c.yaml", "catalog: kane-cli\nversion: 3\nmetrics:\n  self_heals: { type: count, verify: stored }\n");
      const r = run(["verdict", "--lint", "--policy", bad, "--catalog", catalog, "--json"]);
      expect(r.status).toBe(1);
      const [result] = JSON.parse(r.stdout);
      expect(result.diagnostics.map((d: any) => d.code)).toEqual(["policy.unknown_metric", "policy.op_not_allowed"]);
      expect(result.diagnostics[0].hint).toContain("metrics.self_heals");
      expect(run(["verdict", "--lint", "--policy", await writeTmp("p.yaml", PASS)]).status).toBe(0);
    });

    it.each([
      ["no --policy", async () => ["verdict", await sealCopy(await stagePack({ runId: "a" }))]],
      ["an unparseable policy", async () => ["verdict", await sealCopy(await stagePack({ runId: "a" })), "--policy", await writeTmp("x.yaml", "policy: [")]],
      ["a missing policy file", async () => ["verdict", await sealCopy(await stagePack({ runId: "a" })), "--policy", "/nonexistent.yaml"]],
      ["--catalog without --lint", async () => ["verdict", await sealCopy(await stagePack({ runId: "a" })), "--policy", await writeTmp("p.yaml", PASS), "--catalog", "c.yaml"]],
      ["--lint with a pack", async () => ["verdict", "x.evidence", "--lint", "--policy", await writeTmp("p.yaml", PASS)]],
    ] as const)("exits 2 for %s", async (_name, args) => {
      expect(run(await args()).status).toBe(2);
    });
  });
});

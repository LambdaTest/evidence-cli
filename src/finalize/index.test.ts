import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { finalize, sweepIncomplete } from "./index";
import { validate } from "../validate";
import { parseYaml } from "../yaml";

const SRC = path.resolve(__dirname, "../../fixtures/0.1/L0/finalized/running.evidence");
let work: string | undefined;

async function stageCopy(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-fin-"));
  const dst = path.join(tmp, "running.evidence");
  await fs.cp(SRC, dst, { recursive: true });
  work = tmp;
  return dst;
}

afterEach(async () => {
  if (work) await fs.rm(work, { recursive: true, force: true });
  work = undefined;
});

describe("finalize", () => {
  it("derives totals, sets finalized+ended, hashes the definition, and seals in place", async () => {
    const dir = await stageCopy();
    const result = await finalize(dir, { endedAt: "2026-06-28T09:00:30Z" });

    expect(result.totals).toEqual({ tests: 1, passed: 1, failed: 0, broken: 0, skipped: 0 });
    // sealed file replaces the directory at the same path (decision 0039)
    expect(result.sealedPath).toBe(dir);
    const stat = await fs.stat(dir);
    expect(stat.isFile()).toBe(true);

    // the sealed pack validates full-seal clean
    const report = await validate(dir, { profile: "L0" });
    expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("rejects a non-directory input as a usage error", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-fin-"));
    work = tmp;
    const file = path.join(tmp, "x.evidence");
    await fs.writeFile(file, "not a directory");
    await expect(finalize(file, { endedAt: "2026-06-28T09:00:30Z" })).rejects.toMatchObject({ code: "USAGE" });
  });

  it("preserves the producer's run.yaml comment through write-back", async () => {
    const dir = await stageCopy();
    await finalize(dir, { endedAt: "2026-06-28T09:00:30Z" });
    // unzip the sealed file in memory and inspect run.yaml
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(dir);
    const runRaw = zip.getEntry("run.yaml")!.getData().toString("utf8");
    expect(runRaw).toContain("# A live, in-flight pack");
    const run = parseYaml(runRaw) as any;
    expect(run.status).toBe("finalized");
    expect(run.ended).toBe("2026-06-28T09:00:30Z");
    expect(run.totals.tests).toBe(1);
  });

  it("leaves no temp/aside artifacts in the parent after sealing (atomic, 0042)", async () => {
    const dir = await stageCopy();
    await finalize(dir, { endedAt: "2026-06-28T09:00:30Z" });
    const siblings = await fs.readdir(path.dirname(dir));
    expect(siblings.some((s) => /\.evidence\.(tmp|bak)-/.test(s))).toBe(false);
    expect(siblings).toContain("running.evidence"); // the sealed file
  });
});

describe("sweepIncomplete (crash recovery, 0042)", () => {
  let tmp: string | undefined;
  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("restores a live directory from a leftover .bak when the sealed file is absent", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-sweep-"));
    const bak = path.join(tmp, "run.evidence.bak-abc123");
    await fs.mkdir(path.join(bak, "tests"), { recursive: true });
    await fs.writeFile(path.join(bak, "run.yaml"), "evidence: \"0.1\"\n");

    const res = await sweepIncomplete(tmp);

    expect(res.restored).toContain("run.evidence");
    const restored = await fs.stat(path.join(tmp, "run.evidence"));
    expect(restored.isDirectory()).toBe(true);
    expect(await fs.readdir(tmp)).not.toContain("run.evidence.bak-abc123");
  });

  it("removes a redundant .bak when the sealed file already exists", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-sweep-"));
    await fs.writeFile(path.join(tmp, "run.evidence"), "PKsealed");
    const bak = path.join(tmp, "run.evidence.bak-def456");
    await fs.mkdir(bak, { recursive: true });

    const res = await sweepIncomplete(tmp);

    expect(res.removed).toContain("run.evidence.bak-def456");
    expect((await fs.stat(path.join(tmp, "run.evidence"))).isFile()).toBe(true);
    expect(await fs.readdir(tmp)).toEqual(["run.evidence"]);
  });

  it("deletes a stale .tmp file", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-sweep-"));
    await fs.writeFile(path.join(tmp, "run.evidence.tmp-999"), "half-zip");

    const res = await sweepIncomplete(tmp);

    expect(res.removed).toContain("run.evidence.tmp-999");
    expect(await fs.readdir(tmp)).toEqual([]);
  });
});

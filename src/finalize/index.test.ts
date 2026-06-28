import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { finalize } from "./index";
import { validate } from "../validate";
import { parseYaml } from "../yaml";

const SRC = path.resolve(__dirname, "../../fixtures/finalize-L0/running.evidence");
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
});

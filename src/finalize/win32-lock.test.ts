// Regression tests for the Windows transient-lock failure: on win32 an
// antivirus/indexer handle anywhere inside the pack tree makes fs.rename of
// the live directory fail with EPERM (and fs.rm of the .bak aside likewise).
// These inject that fault through fs.promises; the seal must ride it out.
import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { finalize, sweepIncomplete } from "./index";

const SRC = path.resolve(__dirname, "../../fixtures/0.1/L0/finalized/running.evidence");
let work: string | undefined;

async function stageCopy(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-win32-"));
  const dst = path.join(tmp, "running.evidence");
  await fs.cp(SRC, dst, { recursive: true });
  work = tmp;
  return dst;
}

function eperm(): Error {
  const e = new Error("EPERM: operation not permitted") as Error & { code: string };
  e.code = "EPERM";
  return e;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (work) await fs.rm(work, { recursive: true, force: true });
  work = undefined;
});

describe("finalize under transient Windows locks", () => {
  it("seals despite a transient EPERM on the dir→bak rename", async () => {
    const dir = await stageCopy();
    const realRename = fs.rename.bind(fs);
    let failures = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).includes(".bak-") && failures < 2) {
        failures++;
        throw eperm();
      }
      return realRename(from, to);
    });

    const result = await finalize(dir, { endedAt: "2026-06-28T09:00:30Z" });

    expect(failures).toBe(2); // the fault actually fired
    expect(result.sealedPath).toBe(dir);
    expect((await fs.stat(dir)).isFile()).toBe(true);
  });

  it("seals despite a transient EPERM on the tmp→sealed rename", async () => {
    const dir = await stageCopy();
    const realRename = fs.rename.bind(fs);
    let failures = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(from).includes(".tmp-") && failures < 2) {
        failures++;
        throw eperm();
      }
      return realRename(from, to);
    });

    const result = await finalize(dir, { endedAt: "2026-06-28T09:00:30Z" });

    expect(failures).toBe(2);
    expect((await fs.stat(dir)).isFile()).toBe(true);
    expect(result.sealedPath).toBe(dir);
  });

  it("still succeeds when the .bak cleanup rm fails persistently (sweep collects it later)", async () => {
    const dir = await stageCopy();
    const realRm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementation(async (target, opts) => {
      if (String(target).includes(".bak-")) throw eperm();
      return realRm(target, opts);
    });

    const result = await finalize(dir, { endedAt: "2026-06-28T09:00:30Z" });

    expect(result.sealedPath).toBe(dir);
    expect((await fs.stat(dir)).isFile()).toBe(true);
    // the aside is left behind for sweepIncomplete — redundant, not corrupt
    const siblings = await fs.readdir(path.dirname(dir));
    expect(siblings.some((s) => /\.evidence\.bak-/.test(s))).toBe(true);
  });
});

describe("sweepIncomplete under transient Windows locks", () => {
  it("removes a stale .tmp despite a transient EPERM on its rm", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-win32-sweep-"));
    work = tmp;
    await fs.writeFile(path.join(tmp, "run.evidence.tmp-999"), "half-zip");

    const realRm = fs.rm.bind(fs);
    let failures = 0;
    vi.spyOn(fs, "rm").mockImplementation(async (target, opts) => {
      if (String(target).includes(".tmp-") && failures < 2) {
        failures++;
        throw eperm();
      }
      return realRm(target, opts);
    });

    const res = await sweepIncomplete(tmp);

    expect(failures).toBe(2);
    expect(res.removed).toContain("run.evidence.tmp-999");
    expect(await fs.readdir(tmp)).toEqual([]);
  });

  it("restores a .bak despite a transient EPERM on the restore rename", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-win32-sweep-"));
    work = tmp;
    const bak = path.join(tmp, "run.evidence.bak-abc123");
    await fs.mkdir(path.join(bak, "tests"), { recursive: true });
    await fs.writeFile(path.join(bak, "run.yaml"), 'evidence: "0.1"\n');

    const realRename = fs.rename.bind(fs);
    let failures = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (failures < 2) {
        failures++;
        throw eperm();
      }
      return realRename(from, to);
    });

    const res = await sweepIncomplete(tmp);

    expect(failures).toBe(2);
    expect(res.restored).toContain("run.evidence");
    expect((await fs.stat(path.join(tmp, "run.evidence"))).isDirectory()).toBe(true);
  });
});

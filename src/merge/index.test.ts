import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { merge } from "./index";
import { stagePack, sealCopy, writeRules } from "./testkit";
import { parseYaml } from "../yaml";
import { validate } from "../validate";

async function outPath(): Promise<string> {
  return path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evi-merge-")), "m.evidence");
}

const FAILURE = "step: pay\nstatus: broken\nerror: { message: x }\n";

describe("merge()", () => {
  it("end-to-end with --finalize: seals with max(ended), regenerates the failure index post-collision", async () => {
    const a = await sealCopy(
      await stagePack({ runId: "a", ended: "2026-07-08T09:00:00Z", l1: true, tests: { checkout: { status: "broken", failure: FAILURE } } }),
    );
    const b = await sealCopy(
      await stagePack({ runId: "b", ended: "2026-07-08T10:00:00Z", l1: true, tests: { checkout: { status: "passed" }, login: { status: "passed" } } }),
    );
    const out = await outPath();
    const report = await merge([a, b], {
      runId: "nightly",
      out,
      finalize: true,
      rulesPath: await writeRules("tests: { on_collision: prefer_latest }\n"),
    });

    expect(report.output).toMatchObject({ path: out, runId: "nightly", finalized: true });
    expect(report.packs.eligible).toEqual(["a", "b"]);
    expect(report.tests).toMatchObject({ merged: 2, discarded: [] });
    expect(report.tests.collisions[0]).toMatchObject({ test: "checkout", winner: "b" });

    const zip = new AdmZip(out);
    const run = parseYaml(zip.getEntry("run.yaml")!.getData().toString("utf8")) as any;
    expect(run).toMatchObject({ status: "finalized", ended: "2026-07-08T10:00:00Z" });
    expect(run.totals).toEqual({ tests: 2, passed: 2, failed: 0, broken: 0, skipped: 0 });
    const idx = parseYaml(zip.getEntry("failure.yaml")!.getData().toString("utf8")) as any;
    expect(idx.failures).toEqual([]); // pack b's passing checkout won → a's failure record gone

    const report2 = await validate(out, { profile: "L1" });
    expect(report2.valid).toBe(true);
    expect(report2.status).toBe("finalized");
  });

  it("without --finalize the live pack validates clean at L1 while running", async () => {
    const a = await sealCopy(await stagePack({ runId: "a", l1: true, tests: { login: {} } }));
    const b = await sealCopy(await stagePack({ runId: "b", l1: true, tests: { checkout: {} } }));
    const out = await outPath();
    const report = await merge([a, b], { runId: "nightly", out });
    expect(report.output.finalized).toBe(false);
    const v = await validate(out, { profile: "L1" });
    expect(v.valid).toBe(true);
    expect(v.status).toBe("running");
  });

  it("propagates USAGE for a bad rules file before opening packs", async () => {
    const out = await outPath();
    await expect(
      merge(["/nonexistent-a.evidence", "/nonexistent-b.evidence"], {
        runId: "m",
        out,
        rulesPath: await writeRules("tests: { on_collision: newest }\n"),
      }),
    ).rejects.toMatchObject({ code: "USAGE" });
  });

  it("propagates ABORT for collisions under strict defaults", async () => {
    const a = await sealCopy(await stagePack({ runId: "a", tests: { checkout: {} } }));
    const b = await sealCopy(await stagePack({ runId: "b", tests: { checkout: {} } }));
    await expect(merge([a, b], { runId: "m", out: await outPath() })).rejects.toMatchObject({ code: "ABORT" });
  });

  it("skipped packs are reported and consume no label ordinal", async () => {
    const a = await sealCopy(await stagePack({ runId: "a", metrics: { requests: { value: 1, type: "count" } }, tests: { login: {} } }));
    const running = await stagePack({ runId: "skipme" });
    const b = await sealCopy(await stagePack({ runId: "b", metrics: { requests: { value: 2, type: "count" } }, tests: { checkout: {} } }));
    const out = await outPath();
    const report = await merge([a, running, b], {
      runId: "m",
      out,
      rulesPath: await writeRules("packs: { on_ineligible: skip }\n"),
    });
    expect(report.packs.skipped[0]).toMatchObject({ runId: "skipme" });
    const run = parseYaml(await fs.readFile(path.join(out, "run.yaml"), "utf8")) as any;
    expect(Object.keys(run.metrics).sort()).toEqual(["1-a/requests", "2-b/requests"]); // b is ordinal 2, not 3
  });
});

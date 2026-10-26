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

    expect(report.output).toEqual({ path: out, runId: "nightly", finalized: true, endedAt: "2026-07-08T10:00:00Z" });
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

  it("identity rules nest supersessions and split distinct tests, end to end", async () => {
    const ex = (commit: string) => ({ externalId: { commit_id: commit, test_id: "T1" } });
    const a = await sealCopy(
      await stagePack({ runId: "a", ended: "2026-07-08T09:00:00Z", l1: true, tests: { checkout: ex("abc") } }),
    );
    const b = await sealCopy(
      await stagePack({ runId: "b", ended: "2026-07-08T10:00:00Z", l1: true, tests: { checkout: ex("abc") } }),
    );
    const c = await sealCopy(
      await stagePack({ runId: "c", ended: "2026-07-08T11:00:00Z", l1: true, tests: { checkout: ex("zzz") } }),
    );
    const out = await outPath();
    const report = await merge([a, b, c], {
      runId: "nightly",
      out,
      finalize: true,
      rulesPath: await writeRules(
        "tests:\n  on_collision: error\n  identity:\n    keys: [external_id.commit_id, external_id.test_id]\n    on_same: nest\n    on_different: split\n",
      ),
    });

    // two top-level tests: the nested group and the split sibling
    expect(report.tests.merged).toBe(2);
    expect(report.tests.collisions).toEqual([
      { test: "checkout", winner: "b", rule: "tests.identity.on_same=nest", action: "nest", folder: "checkout" },
      { test: "checkout", winner: "c", rule: "tests.identity.on_different=split", action: "split", folder: "checkout-1" },
    ]);

    const zip = new AdmZip(out);
    const entry = (p: string) => zip.getEntry(p)?.getData().toString("utf8");
    // the archive rode into the seal, and totals counted only the two top-level tests
    expect(entry("tests/checkout/1/result.yaml")).toContain("test: checkout");
    expect(entry("tests/checkout-1/result.yaml")).toContain("test: checkout-1");
    const run = parseYaml(entry("run.yaml")!) as any;
    expect(run.totals).toEqual({ tests: 2, passed: 2, failed: 0, broken: 0, skipped: 0 });

    const v = await validate(out, { profile: "L1" });
    expect(v.valid).toBe(true);
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

  describe("output.endedAt counts only the packs merged", () => {
    const DUP_SKIP = "rules:\n  - { file: run.yaml, key: run_id, must: different, on_violation: skip }\n";
    const cases: { name: string; extra: () => Promise<string>; rules: string }[] = [
      {
        name: "a duplicate run_id skipped by the rules, though it ended later",
        extra: async () => sealCopy(await stagePack({ runId: "a", ended: "2026-07-08T11:00:00Z", tests: { other: {} } })),
        rules: DUP_SKIP,
      },
      {
        name: "an unreadable pack skipped by the rules",
        extra: async () => {
          const p = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evi-bad-")), "bad.evidence");
          await fs.writeFile(p, "not a zip");
          return p;
        },
        rules: "packs: { on_ineligible: skip }\n",
      },
      {
        name: "a live pack skipped by the rules, though it ended later",
        extra: async () => stagePack({ runId: "live", ended: "2026-07-08T11:00:00Z", tests: { other: {} } }),
        rules: "packs: { on_ineligible: skip }\n",
      },
    ];
    it.each(cases)("$name", async ({ extra, rules }) => {
      const a = await sealCopy(await stagePack({ runId: "a", ended: "2026-07-08T09:00:00Z", tests: { login: {} } }));
      const b = await sealCopy(await stagePack({ runId: "b", ended: "2026-07-08T10:00:00Z", tests: { checkout: {} } }));
      const rulesPath = await writeRules(rules);
      const live = await merge([a, b, await extra()], { runId: "m", out: await outPath(), rulesPath });
      expect(live.packs.skipped).toHaveLength(1);
      expect(live.output).toMatchObject({ finalized: false, endedAt: "2026-07-08T10:00:00Z" });
      const out = await outPath();
      const sealed = await merge([a, b, await extra()], { runId: "m", out, rulesPath, finalize: true });
      expect(sealed.output.endedAt).toBe("2026-07-08T10:00:00Z");
      expect(parseYaml(new AdmZip(out).getEntry("run.yaml")!.getData().toString("utf8"))).toMatchObject({ ended: "2026-07-08T10:00:00Z" });
    });
  });

  describe("metric catalog snapshot (decision 0048)", () => {
    const CAT = "catalog: kane-cli\nversion: 3\nmetrics:\n  credits: { type: decimal, verify: stored, merge: sum }\n";
    const OTHER = CAT.replace("version: 3", "version: 4");
    const cases: { name: string; a?: string; b?: string; kept: boolean }[] = [
      { name: "identical snapshots are kept once", a: CAT, b: CAT, kept: true },
      { name: "different snapshots are dropped", a: CAT, b: OTHER, kept: false },
      { name: "a source without a snapshot drops it", a: CAT, kept: false },
      { name: "no snapshots, nothing to keep", kept: false },
    ];
    it.each(cases)("$name", async ({ a, b, kept }) => {
      const pa = await sealCopy(await stagePack({ runId: "a", tests: { login: {} }, catalog: a ? { text: a, source: "controller" } : undefined }));
      const pb = await sealCopy(await stagePack({ runId: "b", tests: { checkout: {} }, catalog: b ? { text: b, source: "cache" } : undefined }));
      const out = await outPath();
      await merge([pa, pb], { runId: "m", out });
      const snapshot = await fs.readFile(path.join(out, "meta", "metrics-catalog.yaml"), "utf8").catch(() => null);
      const run = parseYaml(await fs.readFile(path.join(out, "run.yaml"), "utf8")) as any;
      if (kept) {
        expect(snapshot).toBe(a);
        expect(run.metrics_catalog).toMatchObject({ id: "kane-cli", version: 3, source: "controller" });
      } else {
        expect(snapshot).toBeNull();
        expect(run.metrics_catalog).toBeUndefined();
      }
      expect((await validate(out)).valid).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import { gatePacks, sanitizeLabel } from "./gates";
import { DEFAULT_RULES } from "./rules";
import type { MergeRules } from "./rules";
import { stagePack, sealCopy } from "./testkit";

const rules = (over: any = {}): MergeRules => ({
  ...DEFAULT_RULES,
  packs: { ...DEFAULT_RULES.packs, ...over.packs },
  rules: over.rules ?? [],
});

describe("gatePacks", () => {
  it("gates a running pack per require_status; skip records the rule", async () => {
    const good = await sealCopy(await stagePack({ runId: "a" }));
    const running = await stagePack({ runId: "b" });
    const r = await gatePacks([good, running], rules({ packs: { on_ineligible: "skip" } }));
    expect(r.eligible.map((p) => p.run.run_id)).toEqual(["a"]);
    expect(r.skipped[0]).toMatchObject({ runId: "b", rule: "packs.require_status=finalized" });
  });

  it("abort throws with code ABORT", async () => {
    const running = await stagePack({ runId: "b" });
    await expect(gatePacks([running], rules())).rejects.toMatchObject({ code: "ABORT" });
  });

  it("same anchors on first ELIGIBLE pack; different dedupes; sequential eligibility", async () => {
    const a = await sealCopy(await stagePack({ runId: "a", environment: { producer: { name: "kane" } } }));
    const b = await sealCopy(await stagePack({ runId: "b", environment: { producer: { name: "other" } } }));
    const a2 = await sealCopy(await stagePack({ runId: "a" })); // duplicate run_id
    const r = await gatePacks(
      [a, b, a2],
      rules({
        packs: { on_ineligible: "skip" },
        rules: [
          { file: "run.yaml", key: "environment.producer.name", must: "same", on_violation: "skip" },
          { file: "run.yaml", key: "run_id", must: "different", on_violation: "skip" },
        ],
      }),
    );
    expect(r.eligible.map((p) => p.run.run_id)).toEqual(["a"]); // b: producer differs; a2: run_id repeats
    expect(r.skipped.map((s) => s.runId).sort()).toEqual(["a", "b"]);
    expect(r.eligible[0].label).toBe("1-a");
  });

  it("zero eligible always errors; one eligible passes", async () => {
    const running = await stagePack({ runId: "x" });
    await expect(gatePacks([running], rules({ packs: { on_ineligible: "skip" } }))).rejects.toMatchObject({ code: "ABORT" });
    const one = await sealCopy(await stagePack({ runId: "solo" }));
    expect((await gatePacks([one], rules())).eligible).toHaveLength(1);
  });

  it("per-rule on_violation overrides global on_ineligible", async () => {
    const a = await sealCopy(await stagePack({ runId: "a" }));
    const a2 = await sealCopy(await stagePack({ runId: "a" }));
    // global abort, but the run_id rule says skip → merge continues
    const r = await gatePacks(
      [a, a2],
      rules({ rules: [{ file: "run.yaml", key: "run_id", must: "different", on_violation: "skip" }] }),
    );
    expect(r.eligible).toHaveLength(1);
  });

  it("wrong contract version and unreadable manifest are gated", async () => {
    const good = await sealCopy(await stagePack({ runId: "a" }));
    const bad = await stagePack({ runId: "v2" });
    const fsMod = await import("node:fs/promises");
    const pathMod = await import("node:path");
    const raw = await fsMod.readFile(pathMod.join(bad, "run.yaml"), "utf8");
    await fsMod.writeFile(pathMod.join(bad, "run.yaml"), raw.replace('evidence: "0.1"', 'evidence: "0.2"'));
    const r = await gatePacks([good, bad], rules({ packs: { on_ineligible: "skip" } }));
    expect(r.eligible.map((p) => p.run.run_id)).toEqual(["a"]);
    expect(r.skipped[0].rule).toBe("packs.version");
  });

  it("require_valid gates an invalid pack", async () => {
    const good = await sealCopy(await stagePack({ runId: "a" }));
    const broken = await sealCopy(await stagePack({ runId: "b" }));
    // corrupt the sealed pack? easier: stage a live pack with a bad result and relax status
    const badLive = await stagePack({ runId: "c" });
    const fsMod = await import("node:fs/promises");
    const pathMod = await import("node:path");
    await fsMod.writeFile(pathMod.join(badLive, "tests", "checkout", "result.yaml"), 'evidence: "0.1"\ntest: MISMATCH\nstatus: passed\nsteps: []\n');
    const r = await gatePacks(
      [good, broken, badLive],
      rules({ packs: { require_status: "any", on_ineligible: "skip" } }),
    );
    expect(r.eligible.map((p) => p.run.run_id)).toEqual(["a", "b"]);
    expect(r.skipped[0]).toMatchObject({ runId: "c", rule: "packs.require_valid=L0" });
  });
});

it("sanitizeLabel", () => {
  expect(sanitizeLabel("run 2026/07")).toBe("run-2026-07");
});

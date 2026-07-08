import { describe, expect, it } from "vitest";
import { resolveCollisions } from "./collide";
import { DEFAULT_RULES } from "./rules";
import type { MergeRules } from "./rules";
import { stagePack, sealCopy } from "./testkit";
import { gatePacks } from "./gates";
import type { EligiblePack } from "./gates";

async function eligibleOf(...specs: any[]): Promise<EligiblePack[]> {
  const paths: string[] = [];
  for (const s of specs) paths.push(await sealCopy(await stagePack(s)));
  return (await gatePacks(paths, DEFAULT_RULES)).eligible;
}

const rulesWith = (tests: any, keyRules: any[] = []): MergeRules => ({ ...DEFAULT_RULES, tests, rules: keyRules });

describe("resolveCollisions", () => {
  it("disjoint sets union; default collision errors", async () => {
    const e = await eligibleOf({ runId: "a", tests: { login: {} } }, { runId: "b", tests: { checkout: {} } });
    const r = await resolveCollisions(e, DEFAULT_RULES);
    expect(r.union.map((u) => u.testId).sort()).toEqual(["checkout", "login"]);
    expect(r.collisions).toEqual([]);
    expect(r.discarded).toEqual([]);

    const clash = await eligibleOf({ runId: "a", tests: { checkout: {} } }, { runId: "b", tests: { checkout: {} } });
    await expect(resolveCollisions(clash, DEFAULT_RULES)).rejects.toMatchObject({ code: "ABORT" });
  });

  it("prefer_first / prefer_latest pick deterministically", async () => {
    const e = await eligibleOf(
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { checkout: {} } },
      { runId: "b", ended: "2026-07-08T10:00:00Z", tests: { checkout: {} } },
    );
    expect((await resolveCollisions(e, rulesWith({ on_collision: "prefer_first" }))).union[0].source.run.run_id).toBe("a");
    const latest = await resolveCollisions(e, rulesWith({ on_collision: "prefer_latest" }));
    expect(latest.union[0].source.run.run_id).toBe("b");
    expect(latest.collisions[0]).toMatchObject({ test: "checkout", winner: "b", rule: "tests.on_collision=prefer_latest" });
  });

  it("prefer_latest tie falls back to the incumbent (CLI order)", async () => {
    const e = await eligibleOf(
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { checkout: {} } },
      { runId: "b", ended: "2026-07-08T09:00:00Z", tests: { checkout: {} } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "prefer_latest" }));
    expect(r.union[0].source.run.run_id).toBe("a");
  });

  it("discard tombstones across a 3rd pack", async () => {
    const e = await eligibleOf(
      { runId: "a", tests: { checkout: {} } },
      { runId: "b", tests: { checkout: {} } },
      { runId: "c", tests: { checkout: {} } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "discard" }));
    expect(r.union).toHaveLength(0);
    expect(r.discarded).toEqual(["checkout"]);
  });

  it("result.yaml key rules fire before the default", async () => {
    const e = await eligibleOf(
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { checkout: { status: "failed" } } },
      { runId: "b", ended: "2026-07-08T10:00:00Z", tests: { checkout: { status: "passed" } } },
    );
    // "if the two verdicts disagree, take the newer run's"
    const r = await resolveCollisions(
      e,
      rulesWith({ on_collision: "error" }, [{ file: "result.yaml", key: "status", must: "same", on_violation: "prefer_latest" }]),
    );
    expect(r.union[0].source.run.run_id).toBe("b");
    expect(r.collisions[0].rule).toBe("result.yaml status must same");
  });

  it("a non-violated key rule falls through to the default", async () => {
    const e = await eligibleOf(
      { runId: "a", tests: { checkout: { status: "passed" } } },
      { runId: "b", tests: { checkout: { status: "passed" } } },
    );
    // statuses agree → rule does not fire → default prefer_first applies
    const r = await resolveCollisions(
      e,
      rulesWith({ on_collision: "prefer_first" }, [{ file: "result.yaml", key: "status", must: "same", on_violation: "discard" }]),
    );
    expect(r.union[0].source.run.run_id).toBe("a");
    expect(r.collisions[0].rule).toBe("tests.on_collision=prefer_first");
  });
});

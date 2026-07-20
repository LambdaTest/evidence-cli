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

const IDENTITY = { keys: ["external_id.commit_id", "external_id.test_id"], on_same: "nest", on_different: "split" };

describe("resolveCollisions", () => {
  it("disjoint sets union; default collision errors", async () => {
    const e = await eligibleOf({ runId: "a", tests: { login: {} } }, { runId: "b", tests: { checkout: {} } });
    const r = await resolveCollisions(e, DEFAULT_RULES);
    expect(r.groups.map((g) => g.folder).sort()).toEqual(["checkout", "login"]);
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
    expect((await resolveCollisions(e, rulesWith({ on_collision: "prefer_first" }))).groups[0].members[0].run.run_id).toBe("a");
    const latest = await resolveCollisions(e, rulesWith({ on_collision: "prefer_latest" }));
    expect(latest.groups[0].members[0].run.run_id).toBe("b");
    expect(latest.collisions[0]).toMatchObject({ test: "checkout", winner: "b", rule: "tests.on_collision=prefer_latest" });
  });

  it("prefer_latest tie falls back to the incumbent (CLI order)", async () => {
    const e = await eligibleOf(
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { checkout: {} } },
      { runId: "b", ended: "2026-07-08T09:00:00Z", tests: { checkout: {} } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "prefer_latest" }));
    expect(r.groups[0].members[0].run.run_id).toBe("a");
  });

  it("discard tombstones across a 3rd pack", async () => {
    const e = await eligibleOf(
      { runId: "a", tests: { checkout: {} } },
      { runId: "b", tests: { checkout: {} } },
      { runId: "c", tests: { checkout: {} } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "discard" }));
    expect(r.groups).toHaveLength(0);
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
    expect(r.groups[0].members[0].run.run_id).toBe("b");
    expect(r.collisions[0].rule).toBe("result.yaml status must same");
  });

  it("same identity nests superseded members under the canonical folder", async () => {
    const e = await eligibleOf(
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { checkout: { externalId: { commit_id: "abc", test_id: "T1" } } } },
      { runId: "b", ended: "2026-07-08T10:00:00Z", tests: { checkout: { externalId: { commit_id: "abc", test_id: "T1" } } } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "error", identity: IDENTITY }));
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].folder).toBe("checkout");
    expect(r.groups[0].members.map((m) => m.run.run_id)).toEqual(["a", "b"]);
    expect(r.collisions[0]).toMatchObject({
      test: "checkout",
      winner: "b",
      action: "nest",
      folder: "checkout",
      rule: "tests.identity.on_same=nest",
    });
  });

  it("different identity splits into a suffixed sibling folder", async () => {
    const e = await eligibleOf(
      { runId: "a", tests: { checkout: { externalId: { commit_id: "abc", test_id: "T1" } } } },
      { runId: "b", tests: { checkout: { externalId: { commit_id: "def", test_id: "T9" } } } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "error", identity: IDENTITY }));
    expect(r.groups.map((g) => g.folder)).toEqual(["checkout", "checkout-1"]);
    expect(r.groups[1].baseId).toBe("checkout");
    expect(r.groups[1].members.map((m) => m.run.run_id)).toEqual(["b"]);
    expect(r.collisions[0]).toMatchObject({
      test: "checkout",
      winner: "b",
      action: "split",
      folder: "checkout-1",
      rule: "tests.identity.on_different=split",
    });
  });

  it("a third copy joins the group it matches, in allocation order", async () => {
    const e = await eligibleOf(
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { checkout: { externalId: { commit_id: "abc", test_id: "T1" } } } },
      { runId: "b", ended: "2026-07-08T10:00:00Z", tests: { checkout: { externalId: { commit_id: "def", test_id: "T9" } } } },
      { runId: "c", ended: "2026-07-08T11:00:00Z", tests: { checkout: { externalId: { commit_id: "def", test_id: "T9" } } } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "error", identity: IDENTITY }));
    // c matches group 1 (checkout-1), not group 0 — no third folder is minted
    expect(r.groups.map((g) => g.folder)).toEqual(["checkout", "checkout-1"]);
    expect(r.groups[0].members.map((m) => m.run.run_id)).toEqual(["a"]);
    expect(r.groups[1].members.map((m) => m.run.run_id)).toEqual(["b", "c"]);
  });

  it("a split never steals a test id some pack legitimately owns", async () => {
    const e = await eligibleOf(
      { runId: "a", tests: { checkout: { externalId: { commit_id: "abc" } } } },
      { runId: "b", tests: { checkout: { externalId: { commit_id: "def" } }, "checkout-1": {} } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "error", identity: IDENTITY }));
    // "checkout-1" is a real test in pack b, so the split skips to -2
    expect(r.groups.map((g) => g.folder).sort()).toEqual(["checkout", "checkout-1", "checkout-2"]);
    expect(r.groups.find((g) => g.folder === "checkout-2")?.baseId).toBe("checkout");
    expect(r.groups.find((g) => g.folder === "checkout-1")?.baseId).toBe("checkout-1");
  });

  it("absent identity keys on both sides count as the same test", async () => {
    const e = await eligibleOf(
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { checkout: {} } },
      { runId: "b", ended: "2026-07-08T10:00:00Z", tests: { checkout: {} } },
    );
    const r = await resolveCollisions(e, rulesWith({ on_collision: "error", identity: IDENTITY }));
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map((m) => m.run.run_id)).toEqual(["a", "b"]);
  });

  it("a guard rule aborts ahead of the identity block", async () => {
    const e = await eligibleOf(
      { runId: "a", tests: { checkout: { externalId: { commit_id: "abc", org_id: "o1" } } } },
      { runId: "b", tests: { checkout: { externalId: { commit_id: "def", org_id: "o2" } } } },
    );
    // identity alone would split; the org guard must fire first
    await expect(
      resolveCollisions(
        e,
        rulesWith({ on_collision: "error", identity: IDENTITY }, [
          { file: "result.yaml", key: "external_id.org_id", must: "same", on_violation: "error" },
        ]),
      ),
    ).rejects.toMatchObject({ code: "ABORT" });
  });

  it("discard tombstones the base id, dropping split siblings too", async () => {
    const e = await eligibleOf(
      { runId: "a", tests: { checkout: { externalId: { commit_id: "abc" } } } },
      { runId: "b", tests: { checkout: { externalId: { commit_id: "def" } } } },
      { runId: "c", tests: { checkout: { status: "failed", externalId: { commit_id: "ghi" } } } },
    );
    // a vs b split into checkout / checkout-1; c's differing status then discards the whole base id
    const r = await resolveCollisions(
      e,
      rulesWith({ on_collision: "error", identity: IDENTITY }, [
        { file: "result.yaml", key: "status", must: "same", on_violation: "discard" },
      ]),
    );
    expect(r.groups).toHaveLength(0);
    expect(r.discarded).toEqual(["checkout"]);
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
    expect(r.groups[0].members[0].run.run_id).toBe("a");
    expect(r.collisions[0].rule).toBe("tests.on_collision=prefer_first");
  });
});

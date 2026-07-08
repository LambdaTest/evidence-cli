import { parseYaml } from "../yaml";
import { abortErr } from "./gates";
import type { EligiblePack } from "./gates";
import { getKey, violates } from "./rules";
import type { CollisionAction, MergeRules } from "./rules";

export interface UnionEntry {
  testId: string;
  source: EligiblePack;
}

export interface CollisionRecord {
  test: string;
  winner: string; // run_id of the surviving copy ("" when discarded)
  rule: string; // the deciding rule, e.g. "result.yaml status must same" or "tests.on_collision=prefer_latest"
}

/**
 * Union walk over the eligible packs, in CLI order (decision 0045). The first
 * claimant of a test id is the INCUMBENT; later copies collide and resolve
 * pairwise: result.yaml key rules in file order (first violated rule applies
 * its action), else the default tests.on_collision. `discard` TOMBSTONES the
 * id — a third pack's copy stays dropped. A test is atomic: the winner's whole
 * tree travels later; nothing is mixed between copies.
 */
export async function resolveCollisions(
  eligible: EligiblePack[],
  rules: MergeRules,
): Promise<{ union: UnionEntry[]; collisions: CollisionRecord[]; discarded: string[] }> {
  const claims = new Map<string, UnionEntry>();
  const tombstoned = new Set<string>();
  const collisions: CollisionRecord[] = [];

  for (const pack of eligible) {
    for (const testId of await pack.container.listTestIds()) {
      if (tombstoned.has(testId)) continue; // discarded for good
      const incumbent = claims.get(testId);
      if (!incumbent) {
        claims.set(testId, { testId, source: pack });
        continue;
      }

      const [a, b] = await Promise.all([readResult(incumbent.source, testId), readResult(pack, testId)]);
      let action: CollisionAction = rules.tests.on_collision;
      let ruleLabel = `tests.on_collision=${action}`;
      for (const rule of rules.rules) {
        if (rule.file !== "result.yaml") continue;
        if (violates(rule.must, getKey(a, rule.key), getKey(b, rule.key))) {
          action = rule.on_violation as CollisionAction;
          ruleLabel = `result.yaml ${rule.key} must ${rule.must}`;
          break;
        }
      }

      switch (action) {
        case "error":
          throw abortErr(`test "${testId}" collides between packs "${incumbent.source.run.run_id}" and "${pack.run.run_id}" [${ruleLabel}]`);
        case "prefer_first":
          collisions.push({ test: testId, winner: incumbent.source.run.run_id, rule: ruleLabel });
          break;
        case "prefer_latest": {
          const winner = laterOf(incumbent.source, pack) === pack ? pack : incumbent.source;
          if (winner === pack) claims.set(testId, { testId, source: pack });
          collisions.push({ test: testId, winner: winner.run.run_id, rule: ruleLabel });
          break;
        }
        case "discard":
          claims.delete(testId);
          tombstoned.add(testId);
          collisions.push({ test: testId, winner: "", rule: ruleLabel });
          break;
      }
    }
  }

  return { union: [...claims.values()], collisions, discarded: [...tombstoned].sort() };
}

async function readResult(pack: EligiblePack, testId: string): Promise<any> {
  const raw = await pack.container.readResult(testId);
  if (raw == null) return undefined;
  try {
    return parseYaml(raw);
  } catch {
    return undefined; // an unparseable result compares as absent; require_valid normally catches this first
  }
}

/** The pack whose run ended later (fallback started); ties keep the incumbent. */
function laterOf(incumbent: EligiblePack, challenger: EligiblePack): EligiblePack {
  const stamp = (p: EligiblePack): number => {
    const v = typeof p.run?.ended === "string" ? p.run.ended : p.run?.started;
    const t = typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  return stamp(challenger) > stamp(incumbent) ? challenger : incumbent;
}

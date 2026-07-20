import { parseYaml } from "../yaml";
import { abortErr } from "./gates";
import type { EligiblePack } from "./gates";
import { deepEqual, getKey, violates } from "./rules";
import type { CollisionAction, MergeRules } from "./rules";

/** What a collision resolves to: 0045's four actions plus 0046's two shapes. */
type ResolvedAction = CollisionAction | "nest" | "split";

/**
 * One output test directory. `baseId` is the id claimed in the source packs;
 * `folder` is where it lands in the merged pack (they differ only when a split
 * allocates a suffixed sibling). `members` are the packs contributing a copy,
 * in CLI order — more than one only when a policy keeps them all.
 */
export interface TestGroup {
  baseId: string;
  folder: string;
  members: EligiblePack[];
}

export interface CollisionRecord {
  test: string;
  winner: string; // run_id of the surviving copy ("" when discarded)
  rule: string; // the deciding rule, e.g. "result.yaml status must same" or "tests.on_collision=prefer_latest"
  action?: "nest" | "split"; // present only for 0046's shape-changing outcomes
  folder?: string; // the output directory the copy landed in
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
): Promise<{ groups: TestGroup[]; collisions: CollisionRecord[]; discarded: string[] }> {
  const claims = new Map<string, TestGroup[]>();
  const tombstoned = new Set<string>();
  const collisions: CollisionRecord[] = [];

  // Suffix reservation: no split may take a name some pack legitimately owns.
  // The eligible set is already fixed here, so this is computable up front.
  const reserved = new Set<string>();
  for (const pack of eligible) for (const id of await pack.container.listTestIds()) reserved.add(id);
  const allocated = new Set<string>();
  const nextFreeName = (baseId: string): string => {
    for (let i = 1; ; i++) {
      const name = `${baseId}-${i}`;
      if (!reserved.has(name) && !allocated.has(name)) return name;
    }
  };

  for (const pack of eligible) {
    for (const testId of await pack.container.listTestIds()) {
      if (tombstoned.has(testId)) continue; // discarded for good
      const groups = claims.get(testId);
      if (!groups) {
        claims.set(testId, [{ baseId: testId, folder: testId, members: [pack] }]);
        allocated.add(testId);
        continue;
      }
      const incumbent = groups[0];

      const [a, b] = await Promise.all([readResult(representative(incumbent), testId), readResult(pack, testId)]);
      let action: ResolvedAction = rules.tests.on_collision;
      let ruleLabel = `tests.on_collision=${action}`;
      let ruleFired = false;
      for (const rule of rules.rules) {
        if (rule.file !== "result.yaml") continue;
        if (violates(rule.must, getKey(a, rule.key), getKey(b, rule.key))) {
          action = rule.on_violation as CollisionAction;
          ruleLabel = `result.yaml ${rule.key} must ${rule.must}`;
          ruleFired = true;
          break;
        }
      }

      // Stage two (0046): only when no rule fired, so a guard rule still
      // aborts ahead of any grouping and can never become a split folder.
      // The challenger is matched against every group of this base id, in
      // allocation order — that is what makes a 3+-way collision well-defined.
      const identity = rules.tests.identity;
      let target = incumbent;
      if (!ruleFired && identity) {
        let match: TestGroup | undefined;
        for (const group of groups) {
          const rep = await readResult(representative(group), group.baseId);
          if (identity.keys.every((k) => deepEqual(getKey(rep, k), getKey(b, k)))) {
            match = group;
            break;
          }
        }
        action = match ? identity.on_same : identity.on_different;
        ruleLabel = match ? `tests.identity.on_same=${action}` : `tests.identity.on_different=${action}`;
        if (match) target = match;
      }

      switch (action) {
        case "error":
          throw abortErr(
            `test "${testId}" collides between packs "${representative(target).run.run_id}" and "${pack.run.run_id}" [${ruleLabel}]`,
          );
        case "prefer_first":
          collisions.push({ test: testId, winner: representative(target).run.run_id, rule: ruleLabel });
          break;
        case "prefer_latest": {
          const winner = laterOf(representative(target), pack) === pack ? pack : representative(target);
          if (winner === pack) target.members = [pack];
          collisions.push({ test: testId, winner: winner.run.run_id, rule: ruleLabel });
          break;
        }
        case "nest":
          target.members.push(pack);
          collisions.push({
            test: testId,
            winner: latestOf(target.members).run.run_id,
            rule: ruleLabel,
            action: "nest",
            folder: target.folder,
          });
          break;
        case "split": {
          const folder = nextFreeName(testId);
          allocated.add(folder);
          groups.push({ baseId: testId, folder, members: [pack] });
          collisions.push({ test: testId, winner: pack.run.run_id, rule: ruleLabel, action: "split", folder });
          break;
        }
        case "discard":
          claims.delete(testId); // tombstones the BASE ID — split siblings go too
          tombstoned.add(testId);
          collisions.push({ test: testId, winner: "", rule: ruleLabel });
          break;
      }
    }
  }

  return { groups: [...claims.values()].flat(), collisions, discarded: [...tombstoned].sort() };
}

/**
 * Members oldest-first by run end (fallback start). Array#sort is stable and
 * `members` arrive in CLI order, so ties keep CLI order — the tie-break 0045
 * already pins for prefer_latest.
 */
export function orderMembers(members: EligiblePack[]): EligiblePack[] {
  return [...members].sort((x, y) => stampOf(x) - stampOf(y));
}

/** The member whose run ended latest — the copy that takes the canonical slot. */
export function latestOf(members: EligiblePack[]): EligiblePack {
  const ordered = orderMembers(members);
  return ordered[ordered.length - 1];
}

/** A pack's position in time: `ended` when present, else `started`. */
function stampOf(p: EligiblePack): number {
  const v = typeof p.run?.ended === "string" ? p.run.ended : p.run?.started;
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/** A group's representative: its first member in CLI order — the original claimant. */
function representative(group: TestGroup): EligiblePack {
  return group.members[0];
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
  return stampOf(challenger) > stampOf(incumbent) ? challenger : incumbent;
}

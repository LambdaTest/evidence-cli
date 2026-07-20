import type { MergeReport } from "../contract";
import { finalize } from "../finalize";
import { assemble } from "./assemble";
import { resolveCollisions } from "./collide";
import { gatePacks } from "./gates";
import type { EligiblePack } from "./gates";
import { loadRules } from "./rules";

export interface MergeOptions {
  runId: string;
  out: string;
  rulesPath?: string;
  title?: string;
  finalize?: boolean;
}

/**
 * Merge N packs into one under a merge-rules policy (decision 0045). Merge
 * ASSEMBLES a live pack; the existing finalize DERIVES (totals, hashes, root
 * failure index, ended) and seals — opt-in via opts.finalize, which stamps
 * endedAt = max(source ended) (fallback started), the truthful end of the
 * logical run. Deterministic: no clock, no randomness.
 *
 * Errors: {code: "USAGE"} for caller mistakes (bad rules file, existing
 * output); {code: "ABORT"} when policy stops the merge.
 */
export async function merge(inputs: string[], opts: MergeOptions): Promise<MergeReport> {
  const rules = await loadRules(opts.rulesPath); // USAGE errors fire before any pack opens
  const { eligible, skipped } = await gatePacks(inputs, rules);
  const { groups, collisions, discarded } = await resolveCollisions(eligible, rules);
  await assemble(opts.out, { runId: opts.runId, title: opts.title }, eligible, groups);

  let finalized = false;
  if (opts.finalize) {
    await finalize(opts.out, { endedAt: maxEnded(eligible) });
    finalized = true;
  }

  return {
    packs: { eligible: eligible.map((p) => p.run.run_id), skipped },
    tests: { merged: groups.length, collisions, discarded },
    output: { path: opts.out, runId: opts.runId, finalized },
  };
}

/** Latest source end time (fallback started) — RFC3339, compared as timestamps. */
function maxEnded(eligible: EligiblePack[]): string {
  let best = "";
  let bestT = -Infinity;
  for (const p of eligible) {
    const v = typeof p.run?.ended === "string" ? p.run.ended : p.run?.started;
    if (typeof v !== "string") continue;
    const t = Date.parse(v);
    if (!Number.isNaN(t) && t > bestT) {
      bestT = t;
      best = v;
    }
  }
  return best;
}

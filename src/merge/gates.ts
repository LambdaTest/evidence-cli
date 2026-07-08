import * as path from "node:path";
import { CONTRACT_VERSION } from "../contract";
import { openContainer } from "../pack/container";
import type { PackContainer } from "../pack/container";
import { validate } from "../validate";
import { parseYaml } from "../yaml";
import { getKey, violates } from "./rules";
import type { MergeRules, PackAction } from "./rules";

export interface EligiblePack {
  inputPath: string;
  container: PackContainer;
  run: any; // parsed run.yaml
  /** `${i}-${sanitizedRunId}`, 1-based over ELIGIBLE packs — the metrics/coverage namespace. */
  label: string;
}

export interface SkippedPack {
  runId: string; // falls back to the pack's base name when run.yaml is unreadable
  rule: string;
  reason: string;
}

export function abortErr(message: string): Error & { code?: string } {
  const e = new Error(message) as Error & { code?: string };
  e.code = "ABORT";
  return e;
}

export function sanitizeLabel(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_.-]/g, "-");
}

/**
 * Gate each input pack, in CLI order (decision 0045). Gates run cheap →
 * expensive: manifest → version → require_status → require_valid → key rules.
 * SEQUENTIAL ELIGIBILITY: rules compare a candidate only against packs that
 * already survived every gate — an anchor from a pack that later fails is
 * discarded. Zero eligible packs is always an error.
 */
export async function gatePacks(
  inputs: string[],
  rules: MergeRules,
): Promise<{ eligible: EligiblePack[]; skipped: SkippedPack[] }> {
  const eligible: EligiblePack[] = [];
  const skipped: SkippedPack[] = [];
  const fail = (runId: string, rule: string, reason: string, action: PackAction): void => {
    if (action === "abort") throw abortErr(`pack "${runId}": ${reason} [${rule}]`);
    skipped.push({ runId, rule, reason });
  };

  for (const inputPath of inputs) {
    const fallback = path.basename(inputPath).replace(/\.evidence$/, "");
    let container: PackContainer;
    try {
      container = await openContainer(inputPath);
    } catch {
      fail(fallback, "packs.manifest", "unreadable pack", rules.packs.on_ineligible);
      continue;
    }
    const raw = await container.readManifest();
    if (raw == null) {
      fail(fallback, "packs.manifest", "no run.yaml", rules.packs.on_ineligible);
      continue;
    }
    let run: any;
    try {
      run = parseYaml(raw);
    } catch {
      fail(fallback, "packs.manifest", "run.yaml does not parse", rules.packs.on_ineligible);
      continue;
    }
    const runId = typeof run?.run_id === "string" ? run.run_id : fallback;

    if (run?.evidence !== CONTRACT_VERSION) {
      fail(runId, "packs.version", `evidence ${JSON.stringify(run?.evidence)} != ${CONTRACT_VERSION}`, rules.packs.on_ineligible);
      continue;
    }
    if (rules.packs.require_status !== "any" && run?.status !== rules.packs.require_status) {
      fail(runId, `packs.require_status=${rules.packs.require_status}`, `status is ${run?.status}`, rules.packs.on_ineligible);
      continue;
    }
    if (rules.packs.require_valid !== "off") {
      const report = await validate(inputPath, { profile: rules.packs.require_valid });
      if (!report.valid) {
        const errors = report.diagnostics.filter((d) => d.severity === "error").length;
        fail(runId, `packs.require_valid=${rules.packs.require_valid}`, `${errors} validation error(s)`, rules.packs.on_ineligible);
        continue;
      }
    }

    let violated = false;
    for (const rule of rules.rules) {
      if (rule.file !== "run.yaml") continue;
      const mine = getKey(run, rule.key);
      const clash =
        rule.must === "same"
          ? eligible.length > 0 && violates("same", getKey(eligible[0].run, rule.key), mine)
          : eligible.some((p) => violates("different", getKey(p.run, rule.key), mine));
      if (clash) {
        fail(runId, `run.yaml ${rule.key} must ${rule.must}`, `value ${JSON.stringify(mine)}`, rule.on_violation as PackAction);
        violated = true;
        break;
      }
    }
    if (violated) continue;

    eligible.push({ inputPath, container, run, label: "" });
  }

  if (eligible.length === 0) throw abortErr("no eligible packs to merge");
  eligible.forEach((p, i) => {
    p.label = `${i + 1}-${sanitizeLabel(p.run.run_id)}`;
  });
  return { eligible, skipped };
}

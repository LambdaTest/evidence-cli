import * as path from "node:path";
import { createHash } from "node:crypto";
import { Codes } from "../contract";
import type { Diagnostic, Totals, Verdict } from "../contract";
import { err, warn } from "../diagnostics";
import type { PackContainer } from "../pack/container";

interface TestEntry {
  testId: string;
  result: any;
}

export interface CrossCheckInput {
  run: any;
  tests: TestEntry[];
  container: PackContainer;
}

export async function runCrossChecks(input: CrossCheckInput): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = [];
  const finalized = input.run?.status === "finalized";

  // --- Structure-only (every run status) ---
  for (const { testId, result } of input.tests) {
    const loc = `tests/${testId}/result.yaml`;

    // (a) result.test equals the directory name
    if (result?.test !== undefined && result.test !== testId) {
      diags.push(err(Codes.TEST_ID_MISMATCH, loc, `result.test "${result.test}" does not match directory name "${testId}"`));
    }

    // (b)+(c) definition.path declared, contained, and the file exists
    const defPath = result?.definition?.path;
    if (typeof defPath === "string" && defPath.length > 0) {
      if (!isContained(defPath)) {
        diags.push(err(Codes.DEFINITION_PATH_ESCAPE, `${loc}#/definition/path`, `definition.path "${defPath}" escapes the test directory`));
      } else if (!(await input.container.fileExists(testId, defPath))) {
        diags.push(err(Codes.DEFINITION_MISSING, `${loc}#/definition/path`, `definition file "${defPath}" does not exist`));
      }
    }

    // (d) ordinals unique and strictly increasing in array order (gaps allowed)
    const steps: any[] = Array.isArray(result?.steps) ? result.steps : [];
    let prev = -Infinity;
    const seen = new Set<number>();
    steps.forEach((step, i) => {
      const ord = step?.ordinal;
      if (typeof ord !== "number") return; // schema catches missing/typed ordinals
      if (seen.has(ord)) {
        diags.push(err(Codes.ORDINAL_COLLISION, `${loc}#/steps/${i}/ordinal`, `duplicate step ordinal ${ord}`));
      }
      seen.add(ord);
      if (ord <= prev) {
        diags.push(err(Codes.ORDINAL_NOT_INCREASING, `${loc}#/steps/${i}/ordinal`, `step ordinal ${ord} is not strictly increasing (previous ${prev})`));
      }
      prev = ord;
    });

    // Advisory only: a "passed" test with a non-passing step (verdict is authored — 0016)
    const bad = steps.find((s) => s?.status === "failed" || s?.status === "broken");
    if (result?.status === "passed" && bad) {
      diags.push(warn(Codes.STATUS_DISAGREES, loc, `test status "passed" but step "${bad.id}" is "${bad.status}"`));
    }
  }

  if (!finalized) return diags;

  // --- Full seal (status: finalized) ---

  // (e) ended >= started
  const started = input.run?.started;
  const ended = input.run?.ended;
  if (typeof started === "string" && typeof ended === "string") {
    if (Date.parse(ended) < Date.parse(started)) {
      diags.push(err(Codes.ENDED_BEFORE_STARTED, "run.yaml#/ended", `ended (${ended}) is before started (${started})`));
    }
  }

  // (f) totals equals the rolled-up verdicts AND tests == sum of the four buckets
  const rolled = rollup(input.tests);
  const totals = input.run?.totals;
  if (totals && typeof totals === "object") {
    (["tests", "passed", "failed", "broken", "skipped"] as const).forEach((k) => {
      if (totals[k] !== rolled[k]) {
        diags.push(err(Codes.TOTALS_MISMATCH, `run.yaml#/totals/${k}`, `totals.${k} is ${totals[k]} but the rolled-up value is ${rolled[k]}`));
      }
    });
    const bucketSum =
      (totals.passed ?? 0) + (totals.failed ?? 0) + (totals.broken ?? 0) + (totals.skipped ?? 0);
    if (totals.tests !== bucketSum) {
      diags.push(err(Codes.TOTALS_MISMATCH, "run.yaml#/totals/tests", `totals.tests (${totals.tests}) does not equal the sum of the four buckets (${bucketSum})`));
    }
  }

  // (g) every definition.sha256 present and hash-matches its file
  for (const { testId, result } of input.tests) {
    const loc = `tests/${testId}/result.yaml`;
    const defPath = result?.definition?.path;
    if (typeof defPath !== "string" || !isContained(defPath)) continue; // already flagged
    const declared = result?.definition?.sha256;
    if (typeof declared !== "string" || declared.length === 0) {
      diags.push(err(Codes.HASH_MISSING, `${loc}#/definition/sha256`, "definition.sha256 is required on a finalized pack"));
      continue;
    }
    const bytes = await input.container.readBytes(testId, defPath);
    if (!bytes) continue; // missing file already flagged structure-only
    const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (actual !== declared) {
      diags.push(err(Codes.HASH_MISMATCH, `${loc}#/definition/sha256`, `definition.sha256 ${declared} does not match the file hash ${actual}`));
    }
  }

  return diags;
}

/** A path is contained iff it is relative, scheme-less, and never climbs out. */
export function isContained(relPath: string): boolean {
  if (relPath.startsWith("/")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relPath)) return false; // URL scheme
  const norm = path.posix.normalize(relPath);
  if (norm.startsWith("/") || norm === ".." || norm.startsWith("../")) return false;
  return !norm.split("/").includes("..");
}

function rollup(tests: TestEntry[]): Totals {
  const t: Totals = { tests: 0, passed: 0, failed: 0, broken: 0, skipped: 0 };
  for (const { result } of tests) {
    t.tests++;
    const s = result?.status as Verdict | undefined;
    if (s === "passed" || s === "failed" || s === "broken" || s === "skipped") t[s]++;
  }
  return t;
}

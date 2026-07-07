import { Codes } from "../contract";
import type { Diagnostic } from "../contract";
import { err, warn } from "../diagnostics";
import type { PackContainer } from "../pack/container";
import { loadL1Schemas } from "../schemas/compile";
import { parseYaml } from "../yaml";
import { isContained } from "./checks";
import type { ValidateFunction } from "ajv";

export interface L1Input {
  container: PackContainer;
  status: string | null;
  tests: { testId: string; result: any }[];
  version: string;
}

// The L1 artifact layer (decision 0040). Status-gated like L0: artifact PRESENCE
// (logs/, steps/, coverage/) is required only when finalized; shape checks on
// whatever artifacts ARE present run at any status.
export async function runL1Checks(input: L1Input): Promise<Diagnostic[]> {
  const diags: Diagnostic[] = [];
  const finalized = input.status === "finalized";
  const { logsMeta, video, failure, failureIndex } = loadL1Schemas(input.version);

  if (finalized && !(await input.container.isDir("coverage"))) {
    diags.push(err(Codes.L1_COVERAGE_MISSING, "coverage/", "L1 requires a global coverage/ directory"));
  }

  // Every step-level failure.yaml seen (pack-root-relative), for the index
  // completeness cross-check (decision 0044).
  const discovered = new Set<string>();

  for (const { testId, result } of input.tests) {
    const base = `tests/${testId}`;
    await checkLogs(input.container, diags, base, finalized, logsMeta);
    await checkSteps(input.container, diags, base, finalized, result);
    await checkVideo(input.container, diags, base, video);
    await checkFailure(input.container, diags, base, finalized, result, failure, discovered);
  }

  await checkFailureIndex(input.container, diags, finalized, discovered, failureIndex);
  return diags;
}

async function checkLogs(
  c: PackContainer,
  diags: Diagnostic[],
  base: string,
  finalized: boolean,
  logsMeta: ValidateFunction,
): Promise<void> {
  const dir = `${base}/logs`;
  if (!(await c.isDir(dir))) {
    if (finalized) diags.push(err(Codes.L1_LOGS_MISSING, `${dir}/`, "L1 requires a logs/ directory"));
    return;
  }
  const metaRel = `${dir}/meta.yaml`;
  const raw = await c.readText(metaRel);
  if (raw == null) {
    if (finalized) diags.push(err(Codes.L1_LOGS_META_MISSING, metaRel, "logs/ is present but logs/meta.yaml is missing"));
    return;
  }
  let meta: any;
  try {
    meta = parseYaml(raw);
  } catch (e: any) {
    diags.push(err(Codes.L1_LOGS_META_INVALID, metaRel, `logs/meta.yaml is not valid YAML: ${e?.message ?? e}`));
    return;
  }
  if (!logsMeta(meta)) {
    for (const e of logsMeta.errors ?? []) {
      diags.push(err(Codes.L1_LOGS_META_INVALID, `${metaRel}${e.instancePath || ""}`, `${e.instancePath || "/"} ${e.message ?? "schema violation"}`));
    }
    return; // can't trust file declarations if the shape is wrong
  }
  for (const entry of (meta as any).logs as any[]) {
    const file = entry?.file;
    if (typeof file !== "string") continue;
    if (!isContained(file)) {
      diags.push(err(Codes.L1_LOG_PATH_ESCAPE, metaRel, `declared log file "${file}" escapes logs/`));
      continue;
    }
    if (!(await c.exists(`${dir}/${file}`))) {
      diags.push(err(Codes.L1_LOG_FILE_MISSING, `${dir}/${file}`, `declared log file "${file}" does not exist`));
    }
  }
}

async function checkSteps(
  c: PackContainer,
  diags: Diagnostic[],
  base: string,
  finalized: boolean,
  result: any,
): Promise<void> {
  const dir = `${base}/steps`;
  if (!(await c.isDir(dir))) {
    if (finalized) diags.push(err(Codes.L1_STEPS_MISSING, `${dir}/`, "L1 requires a steps/ directory"));
    return;
  }
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const stepKeys = new Set(steps.map((s: any) => `${s?.ordinal}-${s?.id}`));
  for (const entry of await c.listDir(dir)) {
    if (!entry.isDir) continue;
    const m = entry.name.match(/^(\d+)-(.+)$/);
    if (!m) {
      diags.push(err(Codes.L1_STEPS_MALFORMED, `${dir}/${entry.name}`, `step folder "${entry.name}" is not <ordinal>-<id>`));
      continue;
    }
    if (!stepKeys.has(`${Number(m[1])}-${m[2]}`)) {
      diags.push(err(Codes.L1_STEPS_UNMATCHED, `${dir}/${entry.name}`, `step folder "${entry.name}" matches no result.yaml step`));
      continue;
    }
    const files = await c.listDir(`${dir}/${entry.name}`);
    const hasShot = files.some((f) => !f.isDir && /^screenshot\.[^.]+$/i.test(f.name));
    if (!hasShot) {
      // Advisory only (decision 0040): not every framework captures a frame per
      // step; a missing screenshot never fails the pack.
      diags.push(warn(Codes.L1_STEPS_SCREENSHOT_MISSING, `${dir}/${entry.name}`, `step folder "${entry.name}" has no screenshot.<ext>`));
    }
  }
}

// The reference fields of a step-level failure.yaml that point at pack files —
// each is resolved relative to the TEST ROOT and must be contained and exist
// (decision 0044). URLs (page_state.url, error.urls, …) are open, never checked.
function collectFailureRefs(rec: any): { pointer: string; ref: string }[] {
  const refs: { pointer: string; ref: string }[] = [];
  const take = (pointer: string, v: unknown): void => {
    if (typeof v === "string" && v.length > 0) refs.push({ pointer, ref: v });
  };
  take("/repro/definition", rec?.repro?.definition);
  take("/repro/resolved", rec?.repro?.resolved);
  take("/page_state/dom", rec?.page_state?.dom);
  take("/page_state/a11y", rec?.page_state?.a11y);
  take("/page_state/screenshot", rec?.page_state?.screenshot);
  take("/console_at_failure/ref", rec?.console_at_failure?.ref);
  take("/network_at_failure/ref", rec?.network_at_failure?.ref);
  take("/triage/suggested_fix/patch", rec?.triage?.suggested_fix?.patch);
  const evidence = rec?.triage?.rca?.evidence;
  if (Array.isArray(evidence)) {
    evidence.forEach((e: unknown, i: number) => take(`/triage/rca/evidence/${i}`, e));
  }
  return refs;
}

// Step-level failure records (decision 0044). Shape/anchor/reference checks run
// at any status on whatever records exist; the missing-record advisory fires
// only when finalized.
async function checkFailure(
  c: PackContainer,
  diags: Diagnostic[],
  base: string,
  finalized: boolean,
  result: any,
  failure: ValidateFunction,
  discovered: Set<string>,
): Promise<void> {
  const dir = `${base}/steps`;
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const stepByKey = new Map<string, any>(steps.map((s: any) => [`${s?.ordinal}-${s?.id}`, s]));

  if (await c.isDir(dir)) {
    for (const entry of await c.listDir(dir)) {
      if (!entry.isDir) continue;
      const m = entry.name.match(/^(\d+)-(.+)$/);
      if (!m) continue; // malformed folder name is already l1.steps.malformed_name
      const rel = `${dir}/${entry.name}/failure.yaml`;
      const raw = await c.readText(rel);
      if (raw == null) continue;
      discovered.add(rel); // presence is presence — even an invalid record must be indexed

      let rec: any;
      try {
        rec = parseYaml(raw);
      } catch (e: any) {
        diags.push(err(Codes.L1_FAILURE_INVALID, rel, `failure.yaml is not valid YAML: ${e?.message ?? e}`));
        continue;
      }
      if (!failure(rec)) {
        for (const e of failure.errors ?? []) {
          diags.push(err(Codes.L1_FAILURE_INVALID, `${rel}${e.instancePath || ""}`, `${e.instancePath || "/"} ${e.message ?? "schema violation"}`));
        }
        continue; // can't trust anchors/references if the shape is wrong
      }

      const record: any = rec; // schema-conformant past this point

      // Anchor: `step` must equal the folder id AND the folder must map to a step.
      const folderKey = `${Number(m[1])}-${m[2]}`;
      const matched = stepByKey.get(folderKey);
      if (record.step !== m[2] || matched === undefined) {
        diags.push(err(Codes.L1_FAILURE_UNMATCHED, rel, `failure record step "${record.step}" does not match a result.yaml step for folder "${entry.name}"`));
      } else if (typeof matched?.status === "string" && matched.status !== record.status) {
        // Advisory only (decision 0044): mirrors status.disagrees_with_steps.
        diags.push(warn(Codes.L1_FAILURE_STATUS_DISAGREES, rel, `failure record status "${record.status}" disagrees with result.yaml step status "${matched.status}"`));
      }

      // References: contained within the pack (relative to the test root) and existing.
      for (const { pointer, ref } of collectFailureRefs(record)) {
        if (!isContained(ref)) {
          diags.push(err(Codes.L1_FAILURE_REF_ESCAPE, `${rel}#${pointer}`, `referenced file "${ref}" escapes the test directory`));
        } else if (!(await c.exists(`${base}/${ref}`))) {
          diags.push(err(Codes.L1_FAILURE_REF_MISSING, `${rel}#${pointer}`, `referenced file "${ref}" does not exist`));
        }
      }
    }
  }

  if (finalized) {
    // Advisory (decision 0044): a failed/broken step without a record never
    // fails the pack — the screenshot-advisory posture.
    for (const s of steps) {
      if (s?.status !== "failed" && s?.status !== "broken") continue;
      if (typeof s?.ordinal !== "number" || typeof s?.id !== "string") continue;
      const rel = `${dir}/${s.ordinal}-${s.id}/failure.yaml`;
      if (!discovered.has(rel)) {
        diags.push(warn(Codes.L1_FAILURE_MISSING, rel, `step "${s.id}" is "${s.status}" but has no failure.yaml`));
      }
    }
  }
}

// The run-level failure index (decision 0044) — generated by finalize, checked
// here. Presence is required only when finalized; when the index exists, its
// shape, row/path agreement, pointers, and completeness are checked at any status.
async function checkFailureIndex(
  c: PackContainer,
  diags: Diagnostic[],
  finalized: boolean,
  discovered: Set<string>,
  failureIndex: ValidateFunction,
): Promise<void> {
  const rel = "failure.yaml";
  const raw = await c.readText(rel);
  if (raw == null) {
    if (finalized) {
      diags.push(err(Codes.L1_FAILURE_INDEX_MISSING, rel, "L1 requires the finalize-generated failure.yaml index at the pack root"));
    }
    return;
  }

  let idx: any;
  try {
    idx = parseYaml(raw);
  } catch (e: any) {
    diags.push(err(Codes.L1_FAILURE_INDEX_INVALID, rel, `failure.yaml is not valid YAML: ${e?.message ?? e}`));
    return;
  }
  if (!failureIndex(idx)) {
    for (const e of failureIndex.errors ?? []) {
      diags.push(err(Codes.L1_FAILURE_INDEX_INVALID, `${rel}${e.instancePath || ""}`, `${e.instancePath || "/"} ${e.message ?? "schema violation"}`));
    }
    return; // can't trust rows if the shape is wrong
  }

  const listed = new Set<string>();
  const rows = (idx as any).failures as any[];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // A row must agree with its own pointer — without this, a row could carry
    // one test's metadata while pointing at another's record.
    const expected = `tests/${row.test}/steps/${row.ordinal}-${row.step}/failure.yaml`;
    if (row.path !== expected) {
      diags.push(err(Codes.L1_FAILURE_INDEX_INVALID, `${rel}#/failures/${i}/path`, `path "${row.path}" does not agree with its row (expected "${expected}")`));
    }
    listed.add(row.path);
    if (!isContained(row.path) || !(await c.exists(row.path))) {
      diags.push(err(Codes.L1_FAILURE_INDEX_DANGLING, `${rel}#/failures/${i}/path`, `indexed record "${row.path}" does not exist`));
    }
  }
  for (const d of discovered) {
    if (!listed.has(d)) {
      diags.push(err(Codes.L1_FAILURE_INDEX_INCOMPLETE, rel, `step record "${d}" exists but is not indexed`));
    }
  }
}

async function checkVideo(
  c: PackContainer,
  diags: Diagnostic[],
  base: string,
  video: ValidateFunction,
): Promise<void> {
  const rel = `${base}/video.yaml`;
  const raw = await c.readText(rel);
  if (raw == null) return; // optional; an inline video.<ext> is opaque
  let v: any;
  try {
    v = parseYaml(raw);
  } catch (e: any) {
    diags.push(err(Codes.L1_VIDEO_INVALID, rel, `video.yaml is not valid YAML: ${e?.message ?? e}`));
    return;
  }
  if (!video(v)) {
    for (const e of video.errors ?? []) {
      diags.push(err(Codes.L1_VIDEO_INVALID, `${rel}${e.instancePath || ""}`, `${e.instancePath || "/"} ${e.message ?? "schema violation"}`));
    }
  }
}

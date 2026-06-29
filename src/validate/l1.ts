import { Codes } from "../contract";
import type { Diagnostic } from "../contract";
import { err } from "../diagnostics";
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
  const { logsMeta, video } = loadL1Schemas(input.version);

  if (finalized && !(await input.container.isDir("coverage"))) {
    diags.push(err(Codes.L1_COVERAGE_MISSING, "coverage/", "L1 requires a global coverage/ directory"));
  }

  for (const { testId, result } of input.tests) {
    const base = `tests/${testId}`;
    await checkLogs(input.container, diags, base, finalized, logsMeta);
    await checkSteps(input.container, diags, base, finalized, result);
    await checkVideo(input.container, diags, base, video);
  }
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
      diags.push(err(Codes.L1_STEPS_SCREENSHOT_MISSING, `${dir}/${entry.name}`, `step folder "${entry.name}" has no screenshot.<ext>`));
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

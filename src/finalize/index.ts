import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { parseYaml, parseDoc, stringifyDoc } from "../yaml";
import type { FinalizeResult, Totals, Verdict } from "../contract";

export interface FinalizeOptions {
  /** RFC3339 timestamp to write as run.yaml.ended (caller-supplied for testability). */
  endedAt: string;
}

export async function finalize(dir: string, opts: FinalizeOptions): Promise<FinalizeResult> {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    const e = new Error("finalize requires the live <name>.evidence/ directory, not a sealed zip") as Error & { code?: string };
    e.code = "USAGE";
    throw e;
  }

  const testsDir = path.join(dir, "tests");
  const testIds = (await fs.readdir(testsDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const totals: Totals = { tests: 0, passed: 0, failed: 0, broken: 0, skipped: 0 };

  // Derive totals + write each definition.sha256 back into result.yaml.
  for (const id of testIds) {
    const resultPath = path.join(testsDir, id, "result.yaml");
    const raw = await fs.readFile(resultPath, "utf8");
    const obj = parseYaml(raw) as any;

    totals.tests++;
    const s = obj?.status as Verdict | undefined;
    if (s === "passed" || s === "failed" || s === "broken" || s === "skipped") totals[s]++;

    const defPath = obj?.definition?.path;
    if (typeof defPath === "string" && defPath.length > 0) {
      const bytes = await fs.readFile(path.join(testsDir, id, defPath));
      const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const doc = parseDoc(raw);
      doc.setIn(["definition", "sha256"], hash);
      await fs.writeFile(resultPath, stringifyDoc(doc), "utf8");
    }
  }

  // Write derived run-level fields back, preserving producer formatting.
  const runPath = path.join(dir, "run.yaml");
  const runDoc = parseDoc(await fs.readFile(runPath, "utf8"));
  runDoc.setIn(["status"], "finalized");
  runDoc.setIn(["ended"], opts.endedAt);
  runDoc.setIn(["totals"], totals);
  await fs.writeFile(runPath, stringifyDoc(runDoc), "utf8");

  // Seal: build the flat zip of the directory CONTENTS fully in memory, THEN
  // remove the directory and write the file in its place (decision 0039).
  const zip = new AdmZip();
  await addContents(zip, dir, "");
  const buffer = zip.toBuffer();

  const sealedPath = dir; // same path; the directory becomes a file
  await fs.rm(dir, { recursive: true, force: true });
  await fs.writeFile(sealedPath, buffer);

  return { totals, sealedPath };
}

/** Add a directory's contents to the zip flat (no wrapping folder entry). */
async function addContents(zip: AdmZip, dir: string, prefix: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await addContents(zip, abs, rel);
    } else {
      zip.addFile(rel, await fs.readFile(abs));
    }
  }
}

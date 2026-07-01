import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes } from "node:crypto";
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

  // Seal: build the flat zip in memory, then swap it into the directory's place
  // ATOMICALLY (decision 0042): fsynced sibling temp → rename dir aside → rename
  // temp into place → best-effort parent fsync → remove aside. A complete copy of
  // the pack exists at every instant, so no crash can lose or truncate it.
  const zip = new AdmZip();
  await addContents(zip, dir, "");
  const buffer = zip.toBuffer();

  const parent = path.dirname(dir);
  const baseName = path.basename(dir); // <name>.evidence
  const sealedPath = dir; // same path; the directory becomes a file
  const rand = randomBytes(6).toString("hex");
  const tmpPath = path.join(parent, `${baseName}.tmp-${rand}`);
  const bakPath = path.join(parent, `${baseName}.bak-${rand}`);

  const fh = await fs.open(tmpPath, "w");
  try {
    await fh.writeFile(buffer);
    await fh.sync(); // durable temp bytes before the rename (power-loss tier)
  } finally {
    await fh.close();
  }
  await fs.rename(dir, bakPath); // move the live directory aside (atomic)
  await fs.rename(tmpPath, sealedPath); // install the sealed file (atomic)
  await fsyncDir(parent); // persist the directory-entry changes (best-effort)
  await fs.rm(bakPath, { recursive: true, force: true }); // cleanup (non-critical)

  return { totals, sealedPath };
}

/**
 * fsync a directory fd so its entry changes survive power loss. Best-effort:
 * syncing a directory is a POSIX-ism (fine on Linux/macOS, unsupported on
 * Windows), so failure is swallowed — it never makes the seal fail.
 */
async function fsyncDir(dir: string): Promise<void> {
  try {
    const dfd = await fs.open(dir, "r");
    try {
      await dfd.sync();
    } finally {
      await dfd.close();
    }
  } catch {
    // best-effort
  }
}

export interface SweepResult {
  /** pack names restored from a `.bak-` aside (interrupted before install). */
  restored: string[];
  /** stale `.tmp-` / redundant `.bak-` names removed. */
  removed: string[];
}

/**
 * Recover leftovers from an interrupted atomic seal (decision 0042). The host
 * calls this at startup over the directory that holds its packs; evidence-cli
 * itself runs no daemon. After it returns, every pack is either a complete sealed
 * file or a live directory — never a partial. A `.bak-*` is restored to the live
 * directory when the sealed file is absent (else deleted as redundant); a
 * `.tmp-*` is always deleted, since a re-`finalize` regenerates it deterministically.
 */
export async function sweepIncomplete(parentDir: string): Promise<SweepResult> {
  const restored: string[] = [];
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(parentDir);
  } catch {
    return { restored, removed };
  }

  // .bak first (may restore a live dir), then .tmp.
  for (const entry of entries) {
    const m = entry.match(/^(.+\.evidence)\.bak-[0-9a-f]+$/);
    if (!m) continue;
    const base = m[1];
    const basePath = path.join(parentDir, base);
    const bakPath = path.join(parentDir, entry);
    if (await pathExists(basePath)) {
      await fs.rm(bakPath, { recursive: true, force: true });
      removed.push(entry);
    } else {
      await fs.rename(bakPath, basePath);
      restored.push(base);
    }
  }
  for (const entry of entries) {
    if (!/\.evidence\.tmp-[0-9a-f]+$/.test(entry)) continue;
    await fs.rm(path.join(parentDir, entry), { force: true });
    removed.push(entry);
  }
  return { restored, removed };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
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

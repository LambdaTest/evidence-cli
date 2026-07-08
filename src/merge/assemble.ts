import { promises as fs } from "node:fs";
import * as path from "node:path";
import { CONTRACT_VERSION } from "../contract";
import type { PackContainer } from "../pack/container";
import { parseDoc, parseYaml, stringifyDoc, stringifyYaml } from "../yaml";
import type { EligiblePack } from "./gates";
import type { UnionEntry } from "./collide";
import { deepEqual, getKey } from "./rules";

export interface AssembleOptions {
  runId: string;
  title?: string;
}

/**
 * Write the live merged pack (decision 0045). Merge ASSEMBLES only: a
 * synthesized run.yaml, the union winners' whole tests/<id>/ trees, and each
 * source's coverage/ nested under its label. NO derived artifacts — no totals,
 * no ended, no root failure index; finalize regenerates them all.
 */
export async function assemble(
  outDir: string,
  opts: AssembleOptions,
  eligible: EligiblePack[],
  union: UnionEntry[],
): Promise<void> {
  try {
    await fs.access(outDir);
    const e = new Error(`output path "${outDir}" already exists`) as Error & { code?: string };
    e.code = "USAGE";
    throw e;
  } catch (e: any) {
    if (e?.code === "USAGE") throw e; // exists → refuse
  }
  await fs.mkdir(outDir, { recursive: true });

  // Winners' whole trees + per-source coverage nesting.
  for (const entry of union) {
    await copyTree(entry.source.container, `tests/${entry.testId}`, path.join(outDir, "tests", entry.testId));
  }
  for (const pack of eligible) {
    if (await pack.container.isDir("coverage")) {
      await copyTree(pack.container, "coverage", path.join(outDir, "coverage", pack.label));
    }
  }

  // Environment: common subset stays run-level; divergent keys push down per
  // test (0043's lossless merge). Per-test values win over pushed-down ones.
  const envs = eligible.map((p) => (p.run?.environment && typeof p.run.environment === "object" ? p.run.environment : {}));
  const commonEnv: Record<string, unknown> = {};
  const divergent = new Set<string>();
  for (const key of new Set(envs.flatMap((e) => Object.keys(e)))) {
    const first = envs[0][key];
    if (envs.every((e) => key in e && deepEqual(e[key], first))) commonEnv[key] = first;
    else divergent.add(key);
  }
  for (const entry of union) {
    const sourceEnv = entry.source.run?.environment ?? {};
    const pushable = [...divergent].filter((k) => k in sourceEnv);
    if (pushable.length === 0) continue;
    const resultPath = path.join(outDir, "tests", entry.testId, "result.yaml");
    const raw = await fs.readFile(resultPath, "utf8");
    const parsed = parseYaml(raw);
    const doc = parseDoc(raw);
    let dirty = false;
    for (const key of pushable) {
      if (getKey(parsed, `environment.${key}`) !== undefined) continue; // per-test value wins
      doc.setIn(["environment", key], sourceEnv[key]);
      dirty = true;
    }
    if (dirty) await fs.writeFile(resultPath, stringifyDoc(doc), "utf8");
  }

  // Metrics: namespaced by flattening into the name — <label>/<name> — so the
  // merged map still satisfies the 0012 typed-metric shape.
  const metrics: Record<string, unknown> = {};
  for (const pack of eligible) {
    const m = pack.run?.metrics;
    if (!m || typeof m !== "object") continue;
    for (const [name, value] of Object.entries(m)) metrics[`${pack.label}/${name}`] = value;
  }

  const started = eligible
    .map((p) => p.run?.started)
    .filter((s): s is string => typeof s === "string")
    .sort((x, y) => Date.parse(x) - Date.parse(y))[0];

  const run: Record<string, unknown> = {
    evidence: CONTRACT_VERSION,
    run_id: opts.runId,
    status: "running", // a live pack until finalize seals it
    title: opts.title ?? eligible[0].run?.title,
    started,
    merged_from: eligible.map((p) => p.run.run_id),
  };
  if (Object.keys(metrics).length > 0) run.metrics = metrics;
  if (Object.keys(commonEnv).length > 0) run.environment = commonEnv;
  await fs.writeFile(path.join(outDir, "run.yaml"), stringifyYaml(run), "utf8");
}

/** Recursively copy a container subtree (dir or zip source) to the filesystem. */
async function copyTree(c: PackContainer, fromRel: string, toAbs: string): Promise<void> {
  await fs.mkdir(toAbs, { recursive: true });
  for (const entry of await c.listDir(fromRel)) {
    const childRel = `${fromRel}/${entry.name}`;
    const childAbs = path.join(toAbs, entry.name);
    if (entry.isDir) {
      await copyTree(c, childRel, childAbs);
    } else {
      const bytes = await c.readFileBytes(childRel);
      if (bytes != null) await fs.writeFile(childAbs, bytes);
    }
  }
}

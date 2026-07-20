import { promises as fs } from "node:fs";
import * as path from "node:path";
import { CONTRACT_VERSION } from "../contract";
import type { PackContainer } from "../pack/container";
import { parseDoc, parseYaml, stringifyDoc, stringifyYaml } from "../yaml";
import type { EligiblePack } from "./gates";
import { orderMembers } from "./collide";
import type { TestGroup } from "./collide";
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
  groups: TestGroup[],
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

  // Each group's members, whole-tree: the latest run takes the canonical
  // tests/<folder>/ exactly as an uncontested test does, and every superseded
  // member is archived beneath it as 1/, 2/ … oldest first (decision 0046).
  // `written` is the per-copy record the environment push-down works from.
  const written: { pack: EligiblePack; resultPath: string }[] = [];
  for (const group of groups) {
    const ordered = orderMembers(group.members);
    const canonical = ordered[ordered.length - 1];
    const groupDir = path.join(outDir, "tests", group.folder);
    await copyTree(canonical.container, `tests/${group.baseId}`, groupDir);
    written.push({ pack: canonical, resultPath: path.join(groupDir, "result.yaml") });

    for (let i = 0; i < ordered.length - 1; i++) {
      const nestedDir = path.join(groupDir, String(i + 1));
      await copyTree(ordered[i].container, `tests/${group.baseId}`, nestedDir);
      written.push({ pack: ordered[i], resultPath: path.join(nestedDir, "result.yaml") });
    }

    // A split folder must satisfy 0031's test-id/directory equality. A NESTED
    // copy is not validated and keeps its original id — the archive stays
    // truthful about what it was.
    if (group.folder !== group.baseId) {
      await editResult(path.join(groupDir, "result.yaml"), (doc) => {
        doc.set("test", group.folder);
        return true;
      });
    }
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
  // Applied to EVERY copy written, canonical and nested alike, each against
  // its own source pack — the divergent keys are what let an archived copy be
  // read standalone, which is the reason for keeping it at all.
  for (const { pack, resultPath } of written) {
    const sourceEnv = pack.run?.environment ?? {};
    const pushable = [...divergent].filter((k) => k in sourceEnv);
    if (pushable.length === 0) continue;
    await editResult(resultPath, (doc, parsed) => {
      let dirty = false;
      for (const key of pushable) {
        if (getKey(parsed, `environment.${key}`) !== undefined) continue; // per-test value wins
        doc.setIn(["environment", key], sourceEnv[key]);
        dirty = true;
      }
      return dirty;
    });
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

/**
 * Edit a copied result.yaml through the comment-preserving document path, so
 * the definition file is never touched and hash checks stay green. The mutator
 * returns whether it changed anything; false skips the write entirely.
 */
async function editResult(resultPath: string, mutate: (doc: any, parsed: unknown) => boolean): Promise<void> {
  const raw = await fs.readFile(resultPath, "utf8");
  const doc = parseDoc(raw);
  if (mutate(doc, parseYaml(raw))) await fs.writeFile(resultPath, stringifyDoc(doc), "utf8");
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

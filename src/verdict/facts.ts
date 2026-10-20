import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import type { ValidationReport } from "../contract";
import { openContainer } from "../pack/container";
import type { PackContainer } from "../pack/container";
import { validate } from "../validate";
import { parseYaml } from "../yaml";
import { CATALOG_SNAPSHOT_PATH, CORE_CATALOG, DEFAULT_OVER, lintCatalog } from "./catalog";
import type { Catalog } from "./catalog";

/** A pack file a catalog reads, parsed — or why it could not be. */
export type FileFact = { value: unknown } | { error: string };

export interface CatalogProvenance {
  id: string;
  version: number | string;
  sha256: string;
  /** run.yaml metrics_catalog.source, or null when the producer recorded none */
  source: string | null;
}

/**
 * Everything a verdict reads from one pack, loaded once, so judging is a
 * pure function of these facts and the policy.
 */
export interface PackFacts {
  target: string;
  /** sha256 hex of the sealed file's bytes; null for a live directory */
  sha256: string | null;
  runId: string | null;
  contract: string | null;
  status: string | null;
  /** parsed run.yaml, or null when it is missing or does not parse */
  run: any;
  /** true for a pack produced by evidence merge (run.yaml merged_from) */
  merged: boolean;
  /** top-level tests, sorted by id, with their parsed result.yaml */
  tests: { id: string; result: any }[];
  /** the producer catalog snapshot, or null when the pack carries none */
  catalog: Catalog | null;
  catalogProvenance: CatalogProvenance | null;
  /** parsed pack files the catalogs read, by pack-root-relative path */
  files: Record<string, FileFact>;
  /** L0 validation of the pack */
  validation: ValidationReport;
}

async function fileSha256(target: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function parseFile(rel: string, text: string): FileFact {
  try {
    return { value: rel.endsWith(".json") ? JSON.parse(text) : parseYaml(text) };
  } catch (e: any) {
    return { error: `${rel} does not parse: ${e?.message ?? e}` };
  }
}

/** The pack files a catalog's file and aggregate verifies read. */
function filesToRead(catalogs: Catalog[], testIds: string[]): string[] {
  const out = new Set<string>(["failure.yaml"]);
  for (const c of catalogs) {
    for (const m of Object.values(c.metrics)) {
      if (m.verify.kind === "file") out.add(m.verify.file);
      if (m.verify.kind === "aggregate" && m.verify.over !== DEFAULT_OVER) {
        const rest = m.verify.over.slice("tests/*/".length);
        for (const id of testIds) out.add(`tests/${id}/${rest}`);
      }
    }
  }
  return [...out].sort();
}

async function readFiles(c: PackContainer, rels: string[]): Promise<Record<string, FileFact>> {
  const files: Record<string, FileFact> = {};
  for (const rel of rels) {
    const text = await c.readText(rel);
    if (text != null) files[rel] = parseFile(rel, text);
  }
  return files;
}

/**
 * Read a pack (live directory or sealed zip) into PackFacts: run.yaml, the
 * top-level tests, the catalog snapshot, the files the catalogs read, the
 * sealed file's sha256, and an L0 validation report. Never writes.
 */
export async function loadPackFacts(target: string): Promise<PackFacts> {
  const stat = await fs.stat(target);
  const container = await openContainer(target);
  const validation = await validate(target, { profile: "L0" });

  const runText = await container.readManifest();
  let run: any = null;
  if (runText != null) {
    try {
      run = parseYaml(runText);
    } catch {
      run = null;
    }
  }

  const tests: { id: string; result: any }[] = [];
  for (const id of await container.listTestIds()) {
    const text = await container.readResult(id);
    if (text == null) continue;
    try {
      tests.push({ id, result: parseYaml(text) });
    } catch {
      // validate reports result.parse; the pack is then not judged
    }
  }

  let catalog: Catalog | null = null;
  let catalogProvenance: CatalogProvenance | null = null;
  const snapshot = await container.readFileBytes(CATALOG_SNAPSHOT_PATH);
  if (snapshot != null) {
    catalog = lintCatalog(snapshot.toString("utf8"), { location: CATALOG_SNAPSHOT_PATH }).catalog;
    if (catalog) {
      const source = run?.metrics_catalog?.source;
      catalogProvenance = {
        id: catalog.id,
        version: catalog.version,
        sha256: createHash("sha256").update(snapshot).digest("hex"),
        source: typeof source === "string" ? source : null,
      };
    }
  }

  const catalogs = catalog ? [CORE_CATALOG, catalog] : [CORE_CATALOG];
  const files = await readFiles(container, filesToRead(catalogs, tests.map((t) => t.id)));

  return {
    target,
    sha256: stat.isDirectory() ? null : await fileSha256(target),
    runId: typeof run?.run_id === "string" ? run.run_id : null,
    contract: typeof run?.evidence === "string" ? run.evidence : null,
    status: typeof run?.status === "string" ? run.status : null,
    run,
    merged: Array.isArray(run?.merged_from),
    tests,
    catalog,
    catalogProvenance,
    files,
    validation,
  };
}

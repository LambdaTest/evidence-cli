import { promises as fs } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { parseYaml } from "../yaml";

export interface Expected {
  valid: boolean;
  errors: string[];
  warnings: string[];
  notErrors: string[];
  description?: string;
}

export interface Fixture {
  /** human label relative to fixtures/, e.g. "0.1/L0/invalid/ordinal-collision" */
  name: string;
  /** absolute path to the <name>.evidence directory */
  packDir: string;
  expected: Expected;
}

/**
 * Discover every `<name>.evidence/` directory under the given roots, pairing it
 * with its sibling `<name>.expected.yaml` sidecar. `fixturesRoot` is the base the
 * fixture name is reported relative to (e.g. `0.1/L0/invalid/ordinal-collision`),
 * so labels stay unambiguous as more versions/profiles are added. Throws (no
 * silent skips) if a pack has no sidecar, or if an `invalid` expectation declares
 * no error codes.
 */
export function discoverFixtures(fixturesRoot: string, roots: string[]): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      throw new Error(`conformance: fixture root not found: ${root}`);
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".evidence")) continue;
      const packDir = path.join(root, entry);
      const base = entry.replace(/\.evidence$/, "");
      const sidecar = path.join(root, `${base}.expected.yaml`);
      const name = path.relative(fixturesRoot, packDir).replace(/\.evidence$/, "");

      let raw: string;
      try {
        raw = readFileSync(sidecar, "utf8");
      } catch {
        throw new Error(
          `conformance: fixture "${name}" has no expectation sidecar (expected ${base}.expected.yaml beside the pack)`,
        );
      }

      const expected = parseExpected(raw, name);
      fixtures.push({ name, packDir, expected });
    }
  }
  return fixtures;
}

function parseExpected(raw: string, name: string): Expected {
  const obj = parseYaml(raw) as any;
  if (obj == null || typeof obj !== "object") {
    throw new Error(`conformance: ${name}.expected.yaml is not a mapping`);
  }
  if (typeof obj.valid !== "boolean") {
    throw new Error(`conformance: ${name}.expected.yaml is missing a boolean \`valid\``);
  }
  const errors = asStringArray(obj.errors);
  const warnings = asStringArray(obj.warnings);
  const notErrors = asStringArray(obj.not_errors);
  if (obj.valid === false && errors.length === 0) {
    throw new Error(
      `conformance: ${name} is declared invalid but lists no expected \`errors\` — say why it is invalid`,
    );
  }
  return {
    valid: obj.valid,
    errors,
    warnings,
    notErrors,
    description: typeof obj.description === "string" ? obj.description : undefined,
  };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * Build a FLAT sealed zip of a pack directory's contents into a fresh temp dir
 * and return the zip file path (entries are the directory's contents, mirroring
 * what `finalize` emits and `ZipContainer` reads — decision 0028). The caller
 * removes `path.dirname(returnedPath)` when finished.
 */
export async function toZip(packDir: string): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-conf-"));
  const zipPath = path.join(tmp, `${path.basename(packDir)}`);
  const zip = new AdmZip();
  zip.addLocalFolder(packDir);
  zip.writeZip(zipPath);
  return zipPath;
}

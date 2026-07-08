import { promises as fs } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import mergeRulesSchema from "../schemas/merge-rules.schema.json";
import { parseYaml } from "../yaml";

export type PackAction = "abort" | "skip";
export type CollisionAction = "error" | "prefer_first" | "prefer_latest" | "discard";

export interface KeyRule {
  file: "run.yaml" | "result.yaml";
  key: string;
  must: "same" | "different";
  on_violation: string;
}

export interface MergeRules {
  packs: { require_status: "finalized" | "running" | "any"; require_valid: "L0" | "L1" | "off"; on_ineligible: PackAction };
  tests: { on_collision: CollisionAction };
  rules: KeyRule[];
}

// Strict defaults (decision 0045): surprises abort, nothing is dropped silently.
export const DEFAULT_RULES: MergeRules = {
  packs: { require_status: "finalized", require_valid: "L0", on_ineligible: "abort" },
  tests: { on_collision: "error" },
  rules: [],
};

// The rules file is our own tool input, so its schema is compiled once here —
// separate from the pack-contract caches in schemas/compile.ts.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateRules = ajv.compile(mergeRulesSchema as object);

function usageErr(message: string): never {
  const e = new Error(message) as Error & { code?: string };
  e.code = "USAGE";
  throw e;
}

/**
 * Load and validate a merge-rules.yaml, merged over DEFAULT_RULES. Any
 * failure — unreadable file, bad YAML, schema violation — is a USAGE error
 * (exit 2), raised before any pack is opened.
 */
export async function loadRules(rulesPath?: string): Promise<MergeRules> {
  if (!rulesPath) return DEFAULT_RULES;
  let raw: string;
  try {
    raw = await fs.readFile(rulesPath, "utf8");
  } catch {
    usageErr(`cannot read merge-rules file "${rulesPath}"`);
  }
  let doc: any;
  try {
    doc = parseYaml(raw);
  } catch (e: any) {
    usageErr(`merge-rules file is not valid YAML: ${e?.message ?? e}`);
  }
  if (!validateRules(doc)) {
    const first = validateRules.errors?.[0];
    usageErr(`merge-rules.yaml${first?.instancePath ?? ""}: ${first?.message ?? "schema violation"}`);
  }
  return {
    packs: { ...DEFAULT_RULES.packs, ...(doc as any).packs },
    tests: { ...DEFAULT_RULES.tests, ...(doc as any).tests },
    rules: (doc as any).rules ?? [],
  };
}

/** Walk a dot-path into parsed YAML; undefined means the key is absent. */
export function getKey(obj: unknown, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((o, k) => {
    if (o == null || typeof o !== "object") return undefined;
    return (o as Record<string, unknown>)[k];
  }, obj);
}

/** Canonical deep equality: key-order-insensitive objects, ordered arrays. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a != null && b != null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}

/**
 * Does the pair (a, b) violate the predicate? Pins the absent-key semantics
 * (decision 0045): absent == absent counts as same; absent vs present counts
 * as different.
 */
export function violates(must: "same" | "different", a: unknown, b: unknown): boolean {
  return must === "same" ? !deepEqual(a, b) : deepEqual(a, b);
}

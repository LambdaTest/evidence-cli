import { createHash } from "node:crypto";
import type { Diagnostic } from "../contract";
import { err } from "../diagnostics";
import coreCatalogDoc from "../schemas/0.1/evidence-core.catalog.json";
import { loadToolSchema } from "../schemas/compile";
import { isContained } from "../validate/checks";
import { parseYaml } from "../yaml";
import { compileExpr } from "./expr";
import type { Compiled, ExprEnv } from "./expr";

export type MetricType =
  | "count" | "integer" | "ms" | "bytes" | "currency"
  | "ratio" | "percentage" | "decimal"
  | "string" | "enum";
export type MergeRule = "sum" | "min" | "max" | "mean" | "recompute" | "none";
export type AggregateFn = "sum" | "min" | "max" | "mean" | "count" | "p50" | "p90" | "p95";

export type Verify =
  | { kind: "stored" }
  | { kind: "file"; file: string; path: string }
  | { kind: "aggregate"; aggregate: AggregateFn; over: string; path?: string; value?: Compiled; where?: Compiled }
  | { kind: "expr"; expr: Compiled };

export interface MetricDef {
  name: string;
  type: MetricType;
  unit?: string;
  label?: string;
  description?: string;
  range?: [number, number];
  values?: string[];
  per_test: boolean;
  verify: Verify;
  merge: MergeRule;
}

export interface Catalog {
  id: string;
  version: number | string;
  /** sha256 hex of the catalog bytes it was loaded from */
  sha256: string;
  /** true for the built-in evidence-core catalog */
  builtin: boolean;
  metrics: Record<string, MetricDef>;
}

export const CORE_CATALOG_ID = "evidence-core";
/** Where a producer snapshots its catalog inside the pack. */
export const CATALOG_SNAPSHOT_PATH = "meta/metrics-catalog.yaml";
export const DEFAULT_OVER = "tests/*/result.yaml";

/** Operators each metric type allows (decision 0048). */
export const OPS_BY_TYPE: Record<MetricType, readonly string[]> = {
  count: ["equals", "min", "max", "range", "in"],
  integer: ["equals", "min", "max", "range", "in"],
  ms: ["equals", "min", "max", "range", "in"],
  bytes: ["equals", "min", "max", "range", "in"],
  currency: ["equals", "min", "max", "range", "in"],
  ratio: ["min", "max", "range"],
  percentage: ["min", "max", "range"],
  decimal: ["min", "max", "range"],
  string: ["equals", "in"],
  enum: ["equals", "in"],
};

export const INTEGER_TYPES: ReadonlySet<MetricType> = new Set(["count", "integer", "bytes"]);
export const STRING_TYPES: ReadonlySet<MetricType> = new Set(["string", "enum"]);

export class CatalogLoadError extends Error {
  readonly code = "USAGE";
  constructor(message: string, readonly diagnostics: Diagnostic[]) {
    super(message);
  }
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function compileInto(
  src: unknown,
  env: ExprEnv,
  location: string,
  diags: Diagnostic[],
  opts: { bool?: boolean } = {},
): Compiled | undefined {
  if (typeof src !== "string") return undefined;
  const c = compileExpr(src, env);
  if (!("run" in c)) {
    diags.push({ ...c, code: "catalog.expr", location });
    return undefined;
  }
  if (opts.bool && c.type !== "bool" && c.type !== "dyn") {
    diags.push(err("catalog.expr", location, `where must be a bool, but "${src}" is ${c.type}`));
    return undefined;
  }
  return c;
}

function buildCatalog(doc: unknown, sha256: string, builtin: boolean, location: string): { catalog: Catalog | null; diagnostics: Diagnostic[] } {
  const diags: Diagnostic[] = [];
  const validate = loadToolSchema("metrics-catalog");
  if (!validate(doc)) {
    for (const e of validate.errors ?? []) {
      // oneOf on verify reports every branch; the branch errors say more.
      if (e.keyword === "oneOf") continue;
      diags.push(err("catalog.schema", `${location}#${e.instancePath}`, `${e.instancePath || "/"} ${e.message ?? "schema violation"}`));
    }
    return { catalog: null, diagnostics: diags };
  }
  const shaped = doc as { catalog: string; version: number | string; metrics: Record<string, any> };

  const metrics: Record<string, MetricDef> = {};
  for (const [name, m] of Object.entries(shaped.metrics)) {
    const loc = `${location}#/metrics/${name}`;
    if (!builtin && CORE_NAMES.has(name)) {
      diags.push(err("catalog.reserved_name", loc, `"${name}" is a built-in metric name and cannot be redefined by a producer catalog`));
      continue;
    }
    let verify: Verify | undefined;
    const v = m.verify;
    if (v === "stored") {
      verify = { kind: "stored" };
      if (builtin) diags.push(err("catalog.schema", `${loc}/verify`, `built-in metric "${name}" must be recomputed, not stored`));
    } else if ("file" in v) {
      if (!isContained(v.file)) {
        diags.push(err("catalog.path_escape", `${loc}/verify/file`, `file "${v.file}" escapes the pack`));
      } else {
        verify = { kind: "file", file: v.file, path: v.path };
      }
    } else if ("aggregate" in v) {
      const over = v.over ?? DEFAULT_OVER;
      if (!isContained(over.replace("*", "x"))) {
        diags.push(err("catalog.path_escape", `${loc}/verify/over`, `over "${over}" escapes the pack`));
      }
      const value = compileInto(v.value, "test", `${loc}/verify/value`, diags);
      const where = compileInto(v.where, "test", `${loc}/verify/where`, diags, { bool: true });
      if (v.aggregate !== "count" && v.path === undefined && v.value === undefined) {
        diags.push(err("catalog.schema", `${loc}/verify`, `aggregate ${v.aggregate} needs a "path" or a "value" to fold`));
      }
      verify = { kind: "aggregate", aggregate: v.aggregate, over, path: v.path, value, where };
    } else {
      const expr = compileInto(v.expr, "pack", `${loc}/verify/expr`, diags);
      if (expr) verify = { kind: "expr", expr };
    }

    const merge: MergeRule = m.merge ?? "none";
    if (merge === "recompute" && verify && (verify.kind === "stored" || verify.kind === "file")) {
      diags.push(err("catalog.merge_rule", `${loc}/merge`, `merge: recompute needs an aggregate or expr verify; "${name}" is ${verify.kind}`));
    }
    if (m.per_test === true && verify && verify.kind !== "aggregate" && verify.kind !== "expr") {
      diags.push(err("catalog.schema", `${loc}/per_test`, `per_test needs an aggregate or expr verify; "${name}" is ${verify.kind}`));
    }
    if (Array.isArray(m.range) && m.range[0] > m.range[1]) {
      diags.push(err("catalog.schema", `${loc}/range`, `range [${m.range[0]}, ${m.range[1]}] has lo > hi`));
    }
    if (m.values !== undefined && m.type !== "enum") {
      diags.push(err("catalog.schema", `${loc}/values`, `values is only allowed on an enum metric`));
    }
    if (!verify) continue;
    metrics[name] = {
      name,
      type: m.type,
      unit: m.unit,
      label: m.label,
      description: m.description,
      range: m.range,
      values: m.values,
      per_test: m.per_test === true,
      verify,
      merge,
    };
  }
  if (diags.length > 0) return { catalog: null, diagnostics: diags };
  return { catalog: { id: shaped.catalog, version: shaped.version, sha256, builtin, metrics }, diagnostics: [] };
}

/**
 * Check a catalog's text (YAML or JSON) against metrics-catalog.schema.json
 * and the catalog rules: built-in names are reserved, expressions compile,
 * files stay inside the pack, merge: recompute needs a recomputable verify.
 * Every problem is returned; the catalog is null when there is any.
 */
export function lintCatalog(text: string, opts: { location?: string } = {}): { catalog: Catalog | null; diagnostics: Diagnostic[] } {
  const location = opts.location ?? "catalog";
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e: any) {
    return { catalog: null, diagnostics: [err("catalog.parse", location, `catalog is not valid YAML: ${e?.message ?? e}`)] };
  }
  return buildCatalog(doc, sha256Hex(text), false, location);
}

/** Load a producer catalog, or throw CatalogLoadError listing every problem. */
export function loadCatalog(text: string): Catalog {
  const { catalog, diagnostics } = lintCatalog(text);
  if (!catalog) {
    throw new CatalogLoadError(`invalid metric catalog: ${diagnostics.map((d) => d.message).join("; ")}`, diagnostics);
  }
  return catalog;
}

const CORE_NAMES: ReadonlySet<string> = new Set(Object.keys((coreCatalogDoc as any).metrics));

function loadCore(): Catalog {
  const text = JSON.stringify(coreCatalogDoc);
  const { catalog, diagnostics } = buildCatalog(coreCatalogDoc, sha256Hex(text), true, "evidence-core");
  if (!catalog) throw new Error(`built-in catalog is invalid: ${diagnostics.map((d) => d.message).join("; ")}`);
  return catalog;
}

/** The built-in evidence-core catalog (decision 0048). */
export const CORE_CATALOG: Catalog = loadCore();

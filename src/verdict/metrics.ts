import type { Diagnostic } from "../contract";
import { err } from "../diagnostics";
import { getKey } from "../merge/rules";
import { DEFAULT_OVER, INTEGER_TYPES, STRING_TYPES } from "./catalog";
import type { Catalog, MetricDef } from "./catalog";
import { compileExpr, evalExpr, ExprEvalError, makeFacts, percentile } from "./expr";
import type { Compiled } from "./expr";
import type { PackFacts } from "./facts";
import { lookupMetric } from "./lint";

export type Trust = "recomputed" | "file" | "stored";
export type MetricValue = number | string;

export type Resolution =
  | { value: MetricValue; trust: Trust }
  | { error: Diagnostic; trust: Trust | null; actual: unknown; stored: MetricValue | null };

/** One test as an expression sees it: result.yaml plus its id, list fields defaulted. */
export function testFact(t: { id: string; result: any }): Record<string, unknown> {
  const r = t.result && typeof t.result === "object" ? t.result : {};
  return {
    ...r,
    id: t.id,
    tags: Array.isArray(r.tags) ? r.tags : [],
    requirements: Array.isArray(r.requirements) ? r.requirements : [],
    steps: Array.isArray(r.steps) ? r.steps : [],
    flaky: typeof r.flaky === "boolean" ? r.flaky : false,
  };
}

/** Verdict counts over a set of tests, as CEL ints. */
export function countTotals(tests: Record<string, unknown>[]): Record<string, bigint> {
  const t = { tests: 0n, passed: 0n, failed: 0n, broken: 0n, skipped: 0n };
  for (const x of tests) {
    t.tests++;
    const s = x.status;
    if (s === "passed" || s === "failed" || s === "broken" || s === "skipped") t[s]++;
  }
  return t;
}

function fail(code: string, name: string, message: string, extra: { hint?: string; trust?: Trust | null; actual?: unknown; stored?: MetricValue | null } = {}): Resolution {
  const d = err(code, name, message);
  if (extra.hint) d.hint = extra.hint;
  return { error: d, trust: extra.trust ?? null, actual: extra.actual ?? null, stored: extra.stored ?? null };
}

class Unresolved extends Error {
  constructor(readonly resolution: Resolution) {
    super("unresolved");
  }
}

/** Evaluate, turning an expression failure into a verdict.expr_error resolution. */
function evaluate(name: string, c: Compiled, vars: Record<string, unknown>): unknown {
  try {
    return evalExpr(c, makeFacts(vars));
  } catch (e) {
    if (e instanceof ExprEvalError) throw new Unresolved(fail("verdict.expr_error", name, `${name}: ${e.message}`, { trust: "recomputed" }));
    throw e;
  }
}

interface Scope {
  tests: Record<string, unknown>[];
  /** the id of each entry in tests */
  ids: string[];
}

function narrow(name: string, pack: PackFacts, where: string | undefined): Scope {
  const all = pack.tests.map(testFact);
  const ids = pack.tests.map((t) => t.id);
  if (where === undefined) return { tests: all, ids };
  const c = compileExpr(where, "test");
  if (!("run" in c)) throw new Unresolved(fail(c.code, name, `${name}: where ${c.message}`, { hint: c.hint }));
  const keep: number[] = [];
  all.forEach((test, i) => {
    const v = evaluate(name, c, { test, file: pack.tests[i].result, run: pack.run ?? {} });
    if (typeof v !== "boolean") throw new Unresolved(fail("verdict.expr_error", name, `${name}: where gave ${JSON.stringify(v)} for test "${ids[i]}", not a bool`));
    if (v) keep.push(i);
  });
  return { tests: keep.map((i) => all[i]), ids: keep.map((i) => ids[i]) };
}

function fold(name: string, fn: string, values: number[]): number {
  if (fn === "sum") return values.reduce((a, b) => a + b, 0);
  if (values.length === 0) throw new Unresolved(fail("verdict.metric_missing", name, `${name}: no test has a value to take the ${fn} of`, { trust: "recomputed" }));
  switch (fn) {
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
    case "mean": return values.reduce((a, b) => a + b, 0) / values.length;
    case "p50": return percentile(values, 50);
    case "p90": return percentile(values, 90);
    default: return percentile(values, 95);
  }
}

function recompute(def: MetricDef, name: string, pack: PackFacts, scope: Scope): { value: unknown; trust: Trust } {
  const v = def.verify;
  if (v.kind === "expr") {
    const value = evaluate(name, v.expr, {
      run: pack.run ?? {},
      tests: scope.tests,
      totals: countTotals(scope.tests),
      failures: failureRows(pack),
    });
    return { value, trust: "recomputed" };
  }
  if (v.kind === "aggregate") {
    const values: number[] = [];
    let count = 0;
    scope.tests.forEach((test, i) => {
      const id = scope.ids[i];
      let file: unknown;
      if (v.over === DEFAULT_OVER) {
        file = pack.tests.find((t) => t.id === id)?.result;
      } else {
        const rel = `tests/${id}/${v.over.slice("tests/*/".length)}`;
        const f = pack.files[rel];
        if (!f) return; // this test has no such file
        if ("error" in f) throw new Unresolved(fail("verdict.metric_missing", name, `${name}: ${f.error}`, { trust: "recomputed" }));
        file = f.value;
      }
      const ctx = { test, file, run: pack.run ?? {} };
      if (v.where) {
        const keep = evaluate(name, v.where, ctx);
        if (typeof keep !== "boolean") {
          throw new Unresolved(fail("verdict.expr_error", name, `${name}: where gave ${JSON.stringify(keep)} for test "${id}", not a bool`, { trust: "recomputed" }));
        }
        if (!keep) return;
      }
      let x: unknown;
      if (v.path !== undefined) x = getKey(file, v.path);
      else if (v.value) x = evaluate(name, v.value, ctx);
      if (v.aggregate === "count") {
        if (v.path === undefined && !v.value) count++;
        else if (x !== undefined && x !== null) count++;
        return;
      }
      if (x === undefined || x === null) return;
      if (typeof x !== "number") {
        throw new Unresolved(fail("verdict.value_type", name, `${name}: test "${id}" gives ${JSON.stringify(x)}, not a number`, { trust: "recomputed" }));
      }
      values.push(x);
    });
    return { value: v.aggregate === "count" ? count : fold(name, v.aggregate, values), trust: "recomputed" };
  }
  if (v.kind === "file") {
    const f = pack.files[v.file];
    if (!f) throw new Unresolved(fail("verdict.metric_missing", name, `${name}: ${v.file} is not in the pack`, { trust: "file" }));
    if ("error" in f) throw new Unresolved(fail("verdict.metric_missing", name, `${name}: ${f.error}`, { trust: "file" }));
    const value = getKey(f.value, v.path);
    if (value === undefined || value === null) {
      throw new Unresolved(fail("verdict.metric_missing", name, `${name}: ${v.file} has no ${v.path}`, { trust: "file" }));
    }
    return { value, trust: "file" };
  }
  return { value: storedValue(def, name, pack), trust: "stored" };
}

/** The rows of the pack's root failure.yaml index; [] when it has none. */
export function failureRows(pack: PackFacts): unknown[] {
  const f = pack.files["failure.yaml"];
  const rows = f && "value" in f ? (f.value as any)?.failures : undefined;
  return Array.isArray(rows) ? rows : [];
}

/** run.yaml.metrics.<name>, checked against the catalog's type and unit. */
function storedValue(def: MetricDef, name: string, pack: PackFacts): MetricValue {
  const m = pack.run?.metrics?.[def.name];
  if (!m || typeof m !== "object" || m.value === undefined) {
    throw new Unresolved(fail("verdict.metric_missing", name, `${name}: run.yaml has no metrics.${def.name}`, { trust: "stored" }));
  }
  if (m.type !== def.type) {
    throw new Unresolved(fail("verdict.stored_type", name, `${name}: stored type "${m.type}" is not the catalog's "${def.type}"`, { trust: "stored", actual: m.value }));
  }
  if (def.unit && m.unit !== undefined && m.unit !== def.unit) {
    throw new Unresolved(fail("verdict.stored_type", name, `${name}: stored unit "${m.unit}" is not the catalog's "${def.unit}"`, { trust: "stored", actual: m.value }));
  }
  return m.value;
}

/** The stored values of a metric across a merged pack's sources (<label>/<name>). */
function mergedStored(def: MetricDef, name: string, pack: PackFacts): number[] {
  const out: number[] = [];
  for (const [key, m] of Object.entries<any>(pack.run?.metrics ?? {})) {
    const slash = key.indexOf("/");
    if (slash < 0 || key.slice(slash + 1) !== def.name) continue;
    if (typeof m?.value !== "number") {
      throw new Unresolved(fail("verdict.stored_type", name, `${name}: ${key} is not a number`, { trust: "stored" }));
    }
    out.push(m.value);
  }
  if (out.length === 0) throw new Unresolved(fail("verdict.metric_missing", name, `${name}: no merged source stored metrics.<label>/${def.name}`, { trust: "stored" }));
  return out;
}

function checkValue(def: MetricDef, name: string, value: unknown, trust: Trust): MetricValue {
  if (STRING_TYPES.has(def.type)) {
    if (typeof value !== "string") {
      throw new Unresolved(fail("verdict.value_type", name, `${name}: ${JSON.stringify(value)} is not a string (type ${def.type})`, { trust, actual: value }));
    }
    if (def.values && !def.values.includes(value)) {
      throw new Unresolved(fail("verdict.out_of_range", name, `${name}: "${value}" is not one of ${def.values.join(", ")}`, { trust, actual: value }));
    }
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Unresolved(fail("verdict.value_type", name, `${name}: ${JSON.stringify(value)} is not a number (type ${def.type})`, { trust, actual: value }));
  }
  if (INTEGER_TYPES.has(def.type) && !Number.isInteger(value)) {
    throw new Unresolved(fail("verdict.value_type", name, `${name}: ${value} is not an integer (type ${def.type})`, { trust, actual: value }));
  }
  if (def.range && (value < def.range[0] || value > def.range[1])) {
    throw new Unresolved(fail("verdict.out_of_range", name, `${name}: ${value} is outside [${def.range[0]}, ${def.range[1]}]`, { trust, actual: value }));
  }
  return value;
}

function agrees(a: MetricValue, b: MetricValue): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}

function resolveProducerOnMerged(def: MetricDef, name: string, pack: PackFacts, where: string | undefined): { value: unknown; trust: Trust } {
  if (def.merge === "none") {
    throw new Unresolved(fail("verdict.merge_none", name, `${name} cannot be judged on a merged pack: its merge rule is none`, { hint: "the catalog must give it a merge rule (sum, min, max, mean or recompute)" }));
  }
  if (def.merge === "recompute") return recompute(def, name, pack, narrow(name, pack, where));
  if (where !== undefined) {
    throw new Unresolved(fail("verdict.merge_unsupported", name, `${name}: where cannot narrow a merged stored value (merge: ${def.merge})`));
  }
  const values = mergedStored(def, name, pack);
  return { value: fold(name, def.merge, values), trust: "stored" };
}

/**
 * Resolve a policy metric on a pack (decision 0048): built-ins are
 * recomputed; a producer metric follows its catalog verify, is checked
 * against its type, unit and range, and a recompute is cross-checked against
 * any stored value. On a merged pack a producer metric follows its merge
 * rule. Any failure is an error resolution, never a value.
 */
export function resolveMetric(name: string, pack: PackFacts, catalogs: Catalog[], where?: string): Resolution {
  const producer = catalogs.find((c) => !c.builtin) ?? null;
  const found = lookupMetric(name, producer);
  if ("problem" in found) {
    if (found.problem === "no_catalog") {
      return fail("verdict.catalog_missing", name, `pack has no metric catalog; ${name} can't be checked`, { hint: "the producer must seal the pack with its catalog snapshot" });
    }
    return fail("policy.unknown_metric", name, `unknown metric "${name}"`);
  }
  const def = found.def;

  try {
    const { value, trust } =
      !found.builtin && pack.merged
        ? resolveProducerOnMerged(def, name, pack, where)
        : recompute(def, name, pack, narrow(name, pack, where));
    const checked = checkValue(def, name, value, trust);

    if (!found.builtin && !pack.merged && where === undefined && trust !== "stored") {
      const stored = pack.run?.metrics?.[def.name];
      if (stored && typeof stored === "object" && stored.value !== undefined && !agrees(checked, stored.value)) {
        return fail("verdict.stored_mismatch", name, `${name}: the stored value ${JSON.stringify(stored.value)} disagrees with the recomputed ${JSON.stringify(checked)}`, {
          trust,
          actual: checked,
          stored: stored.value,
          hint: `the producer's run.yaml metrics.${def.name} does not match the pack's own files`,
        });
      }
    }
    return { value: checked, trust };
  } catch (e) {
    if (e instanceof Unresolved) return e.resolution;
    throw e;
  }
}


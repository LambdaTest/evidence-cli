import type { Diagnostic } from "../contract";
import { CORE_CATALOG, INTEGER_TYPES, OPS_BY_TYPE, STRING_TYPES } from "./catalog";
import type { Catalog, MetricDef } from "./catalog";
import { compileExpr } from "./expr";
import type { ExprEnv } from "./expr";
import { closest, loadPolicy, policyDiag, satisfiesVersion } from "./policy";
import type { Gate, Policy } from "./policy";

export const PRODUCER_PREFIX = "metrics.";

export interface CheckOptions {
  /** the producer catalog to check against; null/undefined when there is none */
  catalog?: Catalog | null;
  /**
   * true when checking against a pack: a missing catalog is then a fact about
   * the pack (metrics.* gates error at evaluation, `requires` fails) rather
   * than something the author should supply.
   */
  pack?: boolean;
}

function catalogName(c: Catalog): string {
  return `${c.id} catalog v${c.version}`;
}

export type MetricLookup =
  | { def: MetricDef; builtin: boolean }
  | { problem: "unknown" | "builtin_prefixed" | "no_catalog" };

/** Find a policy metric name in evidence-core or the producer catalog. */
export function lookupMetric(name: string, catalog: Catalog | null | undefined): MetricLookup {
  const core = CORE_CATALOG.metrics[name];
  if (core) return { def: core, builtin: true };
  if (name.startsWith(PRODUCER_PREFIX)) {
    const rest = name.slice(PRODUCER_PREFIX.length);
    if (CORE_CATALOG.metrics[rest]) return { problem: "builtin_prefixed" };
    if (!catalog) return { problem: "no_catalog" };
    const def = catalog.metrics[rest];
    return def ? { def, builtin: false } : { problem: "unknown" };
  }
  return { problem: "unknown" };
}

function allNames(catalog: Catalog | null | undefined): string[] {
  return [
    ...Object.keys(CORE_CATALOG.metrics),
    ...(catalog ? Object.keys(catalog.metrics).map((n) => PRODUCER_PREFIX + n) : []),
  ];
}

function describeValue(v: unknown): string {
  return JSON.stringify(v);
}

/** Problems with a threshold for this metric's type, range and values. */
function thresholdProblems(def: MetricDef, op: string, expected: unknown): { message: string; hint?: string }[] {
  const out: { message: string; hint?: string }[] = [];
  const values = op === "range" || op === "in" ? (Array.isArray(expected) ? expected : [expected]) : [expected];
  if (STRING_TYPES.has(def.type)) {
    for (const v of values) {
      if (typeof v !== "string") out.push({ message: `${describeValue(v)} is not a string, but ${def.name} is ${def.type}` });
      else if (def.values && !def.values.includes(v)) {
        out.push({ message: `"${v}" is not a value of ${def.name}`, hint: `values: ${def.values.join(", ")}` });
      }
    }
    return out;
  }
  for (const v of values) {
    if (typeof v !== "number") {
      out.push({ message: `${describeValue(v)} is not a number, but ${def.name} is ${def.type}` });
    } else if (INTEGER_TYPES.has(def.type) && !Number.isInteger(v)) {
      out.push({ message: `${v} is not an integer, but ${def.name} is ${def.type}` });
    } else if (def.range && (v < def.range[0] || v > def.range[1])) {
      out.push({ message: `${v} is outside the range of ${def.name} [${def.range[0]}, ${def.range[1]}]` });
    }
  }
  if (op === "range" && Array.isArray(expected) && typeof expected[0] === "number" && typeof expected[1] === "number" && expected[0] > expected[1]) {
    out.push({ message: `range [${expected[0]}, ${expected[1]}] has lo > hi` });
  }
  return out;
}

function checkExpr(
  policy: Policy,
  gate: Gate,
  field: "expr" | "where",
  env: ExprEnv,
  label: string,
): Diagnostic[] {
  const src = gate[field]!;
  const path = ["gates", gate.index, field];
  const c = compileExpr(src, env);
  if (!("run" in c)) return [policyDiag(policy, c.code, path, `${label}: ${c.message}`, { hint: c.hint })];
  if (c.type !== "bool" && c.type !== "dyn") {
    return [policyDiag(policy, "policy.expr_type", path, `${label}: ${field} must be a bool, but "${src}" is ${c.type}`, { hint: field === "where" ? "e.g. 'checkout' in test.tags" : "compare or test something, e.g. totals.failed == 0" })];
  }
  return [];
}

/**
 * The semantic checks of a loaded policy against evidence-core and a producer
 * catalog: known metric names, operators allowed for the type, threshold
 * types and ranges, where only on per_test metrics, expressions that compile
 * to bools, and `requires`.
 */
export function checkPolicy(policy: Policy, opts: CheckOptions = {}): Diagnostic[] {
  const catalog = opts.catalog ?? null;
  const diags: Diagnostic[] = [];
  const searched = `searched evidence-core ${CORE_CATALOG.version}${catalog ? ` and ${catalogName(catalog)}` : ""}`;

  if (policy.requires) {
    const path = ["requires"];
    const want = `${policy.requires.catalog}${policy.requires.version ? ` ${policy.requires.version}` : ""}`;
    if (!catalog) {
      if (opts.pack) {
        diags.push(policyDiag(policy, "policy.catalog_required", path, `policy requires catalog ${want}, but the pack carries no metric catalog`, { hint: "seal the pack with its producer's catalog snapshot" }));
      } else {
        diags.push(policyDiag(policy, "policy.catalog_needed", path, `policy requires catalog ${want}; no catalog was given to check it against`, { severity: "warning", hint: "pass --catalog <file>, or use kane-cli evidence lint-policy" }));
      }
    } else if (catalog.id !== policy.requires.catalog || (policy.requires.version && !satisfiesVersion(catalog.version, policy.requires.version))) {
      diags.push(policyDiag(policy, "policy.catalog_required", path, `policy requires catalog ${want}, but the catalog is ${catalogName(catalog)}`, { hint: `the pack carries ${catalogName(catalog)}` }));
    }
  }

  for (const gate of policy.gates) {
    const label = `gates[${gate.index}] "${gate.id}"`;
    if (gate.expr !== undefined) {
      diags.push(...checkExpr(policy, gate, "expr", "pack", label));
      continue;
    }
    if (gate.metric === undefined) continue;
    const metricPath = ["gates", gate.index, "metric"];
    const found = lookupMetric(gate.metric, catalog);
    if ("problem" in found) {
      if (found.problem === "no_catalog") {
        if (!opts.pack) {
          diags.push(policyDiag(policy, "policy.catalog_needed", metricPath, `${label}: "${gate.metric}" is a producer metric and no catalog was given to check it against`, { severity: "warning", hint: "pass --catalog <file>, or use kane-cli evidence lint-policy" }));
        }
      } else if (found.problem === "builtin_prefixed") {
        const bare = gate.metric.slice(PRODUCER_PREFIX.length);
        diags.push(policyDiag(policy, "policy.builtin_prefixed", metricPath, `${label}: "${gate.metric}" does not exist; "${bare}" is built-in`, { hint: `write  metric: ${bare}` }));
      } else {
        const producerName = !gate.metric.startsWith(PRODUCER_PREFIX) && catalog?.metrics[gate.metric] ? PRODUCER_PREFIX + gate.metric : undefined;
        const near = producerName ? [] : closest(gate.metric, allNames(catalog));
        const hint = producerName
          ? `producer metrics are always prefixed: write  metric: ${producerName}`
          : `${near.length > 0 ? `did you mean ${near.map((n) => `"${n}"`).join(" or ")}? ` : ""}(${searched})`;
        diags.push(policyDiag(policy, "policy.unknown_metric", metricPath, `${label}: unknown metric "${gate.metric}"`, { hint }));
      }
      continue;
    }

    const def = found.def;
    const allowed = OPS_BY_TYPE[def.type];
    if (gate.op && !allowed.includes(gate.op)) {
      diags.push(policyDiag(policy, "policy.op_not_allowed", ["gates", gate.index, gate.op], `${label}: "${gate.op}" is not allowed on "${gate.metric}" (type ${def.type})`, { key: true, hint: `use one of: ${allowed.join(", ")}` }));
    } else if (gate.op) {
      for (const p of thresholdProblems(def, gate.op, gate.expected)) {
        diags.push(policyDiag(policy, "policy.value_type", ["gates", gate.index, gate.op], `${label}: ${p.message}`, { hint: p.hint ?? `expected ${def.type}${def.range ? ` within [${def.range[0]}, ${def.range[1]}]` : ""}` }));
      }
    }
    if (gate.where !== undefined) {
      if (!def.per_test) {
        const perTest = [
          ...Object.values(CORE_CATALOG.metrics).filter((m) => m.per_test).map((m) => m.name),
          ...(catalog ? Object.values(catalog.metrics).filter((m) => m.per_test).map((m) => PRODUCER_PREFIX + m.name) : []),
        ];
        diags.push(policyDiag(policy, "policy.where_not_per_test", ["gates", gate.index, "where"], `${label}: "${gate.metric}" is a whole-run metric and cannot be narrowed with where`, { hint: `per-test metrics: ${perTest.join(", ")}` }));
      } else {
        diags.push(...checkExpr(policy, gate, "where", "test", label));
      }
    }
  }
  return diags;
}

/**
 * Check a policy's text against evidence-core and an optional producer
 * catalog, reporting every problem at once (decision 0047). The same checks
 * run before every verdict. No pack, no network.
 */
export function lintPolicy(text: string, opts: { catalog?: Catalog | null; source?: string } = {}): Diagnostic[] {
  const { policy, diagnostics } = loadPolicy(text, { source: opts.source });
  const all = policy ? [...checkPolicy(policy, { catalog: opts.catalog }), ...diagnostics] : diagnostics;
  return all
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.line ?? Infinity) - (b.d.line ?? Infinity) || a.i - b.i)
    .map((x) => x.d);
}

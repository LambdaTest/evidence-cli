import { Environment } from "@marcbachmann/cel-js";
import type { Diagnostic } from "../contract";
import { err } from "../diagnostics";

/**
 * The CEL wrapper behind every policy and catalog expression (decision 0049).
 * Two contexts: `pack` (gate expr, catalog verify.expr) sees run, tests,
 * totals, failures; `test` (where, aggregate value/where) sees test, file, run.
 * Numbers read from pack files are CEL doubles; counts the caller computes are
 * passed as BigInt and are CEL ints.
 */
export type ExprEnv = "pack" | "test";

export const EXPR_LIMITS = {
  maxAstNodes: 1000,
  maxDepth: 32,
  /** list-element reads from the facts allowed in one evaluation */
  maxElementReads: 1_000_000,
} as const;

const VARIABLES: Record<ExprEnv, [string, string][]> = {
  pack: [
    ["run", "map"],
    ["tests", "list<map>"],
    ["totals", "map<string, int>"],
    ["failures", "list<map>"],
  ],
  test: [
    ["test", "map"],
    ["file", "dyn"],
    ["run", "map"],
  ],
};

export interface Compiled {
  src: string;
  env: ExprEnv;
  /** the checked result type, e.g. bool, double, int, dyn */
  type: string;
  run: (ctx: Record<string, unknown>) => unknown;
}

/** Facts bound to one evaluation context, with the cost meter their lists report to. */
export interface Facts {
  vars: Record<string, unknown>;
  meter: { left: number };
}

export class ExprEvalError extends Error {
  readonly code = "verdict.expr_error";
}

function numbersOf(fn: string, list: unknown[]): { ints: bigint[] } | { doubles: number[] } {
  if (list.every((v) => typeof v === "bigint")) return { ints: list as bigint[] };
  if (list.every((v) => typeof v === "number")) return { doubles: list as number[] };
  if (list.every((v) => typeof v === "bigint" || typeof v === "number")) {
    throw new Error(`${fn}() mixes int and double values; convert with double()`);
  }
  throw new Error(`${fn}() needs a list of numbers`);
}

function sum(list: unknown[]): bigint | number {
  const n = numbersOf("sum", list);
  if ("ints" in n) return n.ints.reduce((a, b) => a + b, 0n);
  return n.doubles.reduce((a, b) => a + b, 0);
}

function asDoubles(fn: string, list: unknown[]): number[] {
  const n = numbersOf(fn, list);
  const out = "ints" in n ? n.ints.map(Number) : n.doubles;
  if (out.length === 0) throw new Error(`${fn}() of an empty list`);
  return out;
}

function mean(list: unknown[]): number {
  const xs = asDoubles("mean", list);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Nearest-rank percentile: the value at rank ceil(p/100 × n), rank 0 read as 1. */
export function percentile(list: unknown[], p: unknown): number {
  const xs = [...asDoubles("percentile", list)].sort((a, b) => a - b);
  const q = Number(p);
  if (!(q >= 0 && q <= 100)) throw new Error(`percentile() needs p in [0, 100], got ${q}`);
  const rank = Math.max(1, Math.ceil((q / 100) * xs.length));
  return xs[rank - 1];
}

function newEnv(kind: ExprEnv): Environment {
  const env = new Environment({ limits: { maxAstNodes: EXPR_LIMITS.maxAstNodes, maxDepth: EXPR_LIMITS.maxDepth } });
  for (const [name, type] of VARIABLES[kind]) env.registerVariable(name, type);
  for (const t of ["int", "double"]) {
    env.registerFunction(`sum(list<${t}>): ${t}`, sum);
    env.registerFunction(`mean(list<${t}>): double`, mean);
    for (const p of ["int", "double"]) env.registerFunction(`percentile(list<${t}>, ${p}): double`, percentile);
  }
  return env;
}

const ENVS: Record<ExprEnv, Environment> = { pack: newEnv("pack"), test: newEnv("test") };

function variableList(env: ExprEnv): string {
  return VARIABLES[env].map(([n]) => n).join(", ");
}

function exprDiagnostic(code: string, src: string, e: any, env: ExprEnv): Diagnostic {
  const summary = typeof e?.summary === "string" ? e.summary : String(e?.message ?? e).split("\n")[0];
  const at = typeof e?.range?.start === "number" ? ` at column ${e.range.start + 1}` : "";
  const d = err(code, "expr", `${summary}${at} in "${src}"`);
  d.hint = `available variables: ${variableList(env)}; functions include size, sum, mean, percentile`;
  return d;
}

/**
 * Parse and type-check an expression for one context. A parse error (or a
 * structural limit) is policy.expr_syntax; a type error, including an
 * unknown variable, is policy.expr_type. The caller sets the location.
 */
export function compileExpr(src: string, env: ExprEnv): Compiled | Diagnostic {
  let parsed: ReturnType<Environment["parse"]>;
  try {
    parsed = ENVS[env].parse(src);
  } catch (e) {
    return exprDiagnostic("policy.expr_syntax", src, e, env);
  }
  const checked = parsed.check();
  if (!checked.valid) {
    const code = checked.error?.name === "ParseError" ? "policy.expr_syntax" : "policy.expr_type";
    return exprDiagnostic(code, src, checked.error, env);
  }
  return { src, env, type: checked.type ?? "dyn", run: (ctx) => parsed(ctx) };
}

/**
 * Prepare facts for evaluation: a deep copy whose lists count element reads
 * against the shared meter, so evalExpr can bound the work of one evaluation.
 */
export function makeFacts(vars: Record<string, unknown>): Facts {
  const meter = { left: EXPR_LIMITS.maxElementReads };
  const wrap = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const items = v.map(wrap);
      return new Proxy(items, {
        get(target, key, receiver) {
          if (typeof key === "string" && /^\d+$/.test(key) && --meter.left < 0) {
            throw new ExprEvalError(`evaluation cost limit exceeded (${EXPR_LIMITS.maxElementReads} list reads)`);
          }
          return Reflect.get(target, key, receiver);
        },
      });
    }
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wrap(x)]));
    }
    return v;
  };
  const wrapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) wrapped[k] = wrap(v);
  return { vars: wrapped, meter };
}

/** Convert a CEL result to plain JSON-safe values: ints become numbers. */
function fromCel(v: unknown): unknown {
  if (typeof v === "bigint") {
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new ExprEvalError(`result ${v} is outside the safe integer range`);
    return n;
  }
  if (typeof v === "number" && !Number.isFinite(v)) throw new ExprEvalError(`result is not a finite number (${v})`);
  if (Array.isArray(v)) return v.map(fromCel);
  if (v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromCel(x)]));
  }
  return v;
}

/**
 * Evaluate a compiled expression against prepared facts. Any failure —
 * a CEL error, the cost limit, a non-finite result — throws ExprEvalError.
 */
export function evalExpr(c: Compiled, facts: Facts): unknown {
  facts.meter.left = EXPR_LIMITS.maxElementReads;
  let value: unknown;
  try {
    value = c.run(facts.vars);
  } catch (e: any) {
    if (e instanceof ExprEvalError) throw e;
    const summary = typeof e?.summary === "string" ? e.summary : String(e?.message ?? e).split("\n")[0];
    throw new ExprEvalError(`${summary} in "${c.src}"`);
  }
  return fromCel(value);
}

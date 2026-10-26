import { createHash } from "node:crypto";
import { isMap } from "yaml";
import type { Document, LineCounter } from "yaml";
import type { Diagnostic } from "../contract";
import { err } from "../diagnostics";
import { loadToolSchema } from "../schemas/compile";
import { parseDocWithLines } from "../yaml";

export type Op = "equals" | "min" | "max" | "range" | "in";
export type GateSeverity = "blocking" | "warning";

export const OPS: readonly Op[] = ["equals", "min", "max", "range", "in"];

export interface Gate {
  id: string;
  /** position in the policy's gates list */
  index: number;
  metric?: string;
  expr?: string;
  where?: string;
  op?: Op;
  expected?: unknown;
  severity: GateSeverity;
  message?: string;
  /** 1-based line of the gate in the policy file */
  line?: number;
}

export interface Policy {
  id: string;
  requires?: { catalog: string; version?: string };
  gates: Gate[];
  /** sha256 hex of the exact policy text */
  sha256: string;
  /** name used in diagnostic locations */
  source: string;
  /** 1-based line and column of a node, by path from the document root */
  locate(path: (string | number)[], key?: boolean): { line: number; column: number } | undefined;
}

const TOP_KEYS = ["policy", "requires", "gates"];
const REQUIRES_KEYS = ["catalog", "version"];
const GATE_KEYS = ["id", "metric", "expr", "where", ...OPS, "severity", "message"];

/** Levenshtein distance, for "did you mean" hints. */
function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Up to three candidates close to `name`: a shared prefix, or a small edit distance. */
export function closest(name: string, candidates: Iterable<string>): string[] {
  const limit = Math.max(2, Math.floor(name.length / 3));
  return [...candidates]
    .map((c) => ({ c, d: c.startsWith(name) || name.startsWith(c) ? 0.5 : distance(name, c) }))
    .filter((x) => x.d <= limit)
    .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
    .slice(0, 3)
    .map((x) => x.c);
}

export function didYouMean(name: string, candidates: Iterable<string>): string | undefined {
  const near = closest(name, candidates);
  return near.length > 0 ? `did you mean ${near.map((n) => `"${n}"`).join(" or ")}?` : undefined;
}

function makeLocate(doc: Document.Parsed, lines: LineCounter): Policy["locate"] {
  return (path, key) => {
    let offset: number | undefined;
    if (key && path.length > 0) {
      const parent = path.length === 1 ? doc.contents : doc.getIn(path.slice(0, -1), true);
      if (isMap(parent)) {
        const pair = parent.items.find((p: any) => p.key?.value === path[path.length - 1]);
        offset = (pair?.key as any)?.range?.[0];
      }
    } else {
      const node: any = path.length === 0 ? doc.contents : doc.getIn(path, true);
      offset = node?.range?.[0];
    }
    if (offset === undefined) return undefined;
    const pos = lines.linePos(offset);
    return { line: pos.line, column: pos.col };
  };
}

/** Build a diagnostic placed at a node of the policy file. */
export function policyDiag(
  policy: Pick<Policy, "source" | "locate">,
  code: string,
  path: (string | number)[],
  message: string,
  opts: { hint?: string; key?: boolean; severity?: "error" | "warning" } = {},
): Diagnostic {
  const d = err(code, `${policy.source}#/${path.join("/")}`, message);
  if (opts.severity) d.severity = opts.severity;
  if (opts.hint) d.hint = opts.hint;
  const at = policy.locate(path, opts.key) ?? policy.locate(path.slice(0, -1));
  if (at) {
    d.line = at.line;
    d.column = at.column;
  }
  return d;
}

function gateLabel(raw: any, index: number): string {
  return typeof raw?.id === "string" ? `gates[${index}] "${raw.id}"` : `gates[${index}]`;
}

function schemaMessage(e: { instancePath: string; keyword: string; message?: string; params: any }, doc: any): string {
  const parts = e.instancePath.split("/").slice(1);
  const where = parts[0] === "gates" && parts.length >= 2 ? gateLabel(doc?.gates?.[Number(parts[1])], Number(parts[1])) : "policy";
  const field = parts[0] === "gates" ? parts.slice(2).join(".") : parts.join(".");
  const subject = field ? `${where} ${field}` : where;
  if (e.keyword === "required") return `${subject}: missing "${e.params.missingProperty}"`;
  if (e.keyword === "enum") return `${subject}: must be one of ${e.params.allowedValues.join(", ")}`;
  return `${subject}: ${e.message ?? "schema violation"}`;
}

/**
 * Structural checks a gate shape needs beyond plain JSON Schema keywords:
 * exactly one of metric/expr, exactly one operator on a metric gate, and no
 * operator or where on an expression gate. The schema expresses the same
 * rules with oneOf/not; these messages say which part is wrong.
 */
function gateShapeProblems(raw: any): string[] {
  const ops = OPS.filter((o) => raw[o] !== undefined);
  const hasMetric = raw.metric !== undefined;
  const hasExpr = raw.expr !== undefined;
  if (hasMetric && hasExpr) return [`has both "metric" and "expr"; a gate is one or the other`];
  if (!hasMetric && !hasExpr) return [`needs "metric" or "expr"`];
  if (hasExpr) {
    const extra = [...ops, ...(raw.where !== undefined ? ["where"] : [])];
    return extra.length > 0 ? [`is an expression gate and takes no operator or where (found ${extra.join(", ")})`] : [];
  }
  if (ops.length === 0) return [`needs one operator: ${OPS.join(", ")}`];
  if (ops.length > 1) return [`has several operators (${ops.join(", ")}); use one, or range: [lo, hi]`];
  return [];
}

/**
 * Load a policy's text and check its structure: YAML, unknown keys (with the
 * closest valid key), policy.schema.json, gate shape, duplicate gate ids.
 * Every problem is returned at once. `policy` is null only when the text is
 * not a YAML mapping; otherwise it holds every well-formed gate, so the
 * semantic checks in lint can still run on them.
 */
export function loadPolicy(text: string, opts: { source?: string } = {}): { policy: Policy | null; diagnostics: Diagnostic[] } {
  const source = opts.source ?? "policy";
  const { doc, lines } = parseDocWithLines(text);
  const locate = makeLocate(doc, lines);
  const at = { source, locate };
  const diags: Diagnostic[] = [];

  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      const d = err("policy.parse", source, `policy is not valid YAML: ${e.message.split("\n")[0]}`);
      const pos = e.linePos?.[0];
      if (pos) {
        d.line = pos.line;
        d.column = pos.col;
      }
      diags.push(d);
    }
    return { policy: null, diagnostics: diags };
  }
  const raw: any = doc.toJS();
  if (!isMap(doc.contents)) {
    diags.push(policyDiag(at, "policy.schema", [], "a policy must be a mapping with `policy` and `gates`"));
    return { policy: null, diagnostics: diags };
  }

  const unknown = (obj: any, allowed: string[], path: (string | number)[], label: string): void => {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const k of Object.keys(obj)) {
      if (allowed.includes(k)) continue;
      diags.push(policyDiag(at, "policy.unknown_key", [...path, k], `${label}: unknown key "${k}"`, { key: true, hint: didYouMean(k, allowed) ?? `allowed keys: ${allowed.join(", ")}` }));
    }
  };
  unknown(raw, TOP_KEYS, [], "policy");
  unknown(raw.requires, REQUIRES_KEYS, ["requires"], "requires");
  const rawGates: unknown[] = Array.isArray(raw.gates) ? raw.gates : [];
  rawGates.forEach((g, i) => unknown(g, GATE_KEYS, ["gates", i], gateLabel(g, i)));

  const validate = loadToolSchema("policy");
  if (!validate(raw)) {
    for (const e of validate.errors ?? []) {
      if (e.keyword === "additionalProperties") continue; // reported as policy.unknown_key
      if (/\/(oneOf|not|anyOf)(\/|$)/.test(e.schemaPath)) continue; // gate shape, reported below
      const path = e.instancePath.split("/").slice(1).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
      diags.push(policyDiag(at, "policy.schema", path, schemaMessage(e, raw)));
    }
  }

  const gates: Gate[] = [];
  const seen = new Map<string, number | undefined>();
  rawGates.forEach((g: any, index) => {
    if (g === null || typeof g !== "object" || Array.isArray(g)) return; // the schema pass reported it
    for (const problem of gateShapeProblems(g)) {
      diags.push(policyDiag(at, "policy.schema", ["gates", index], `${gateLabel(g, index)} ${problem}`));
    }
    if (typeof g.id !== "string") return;
    const line = locate(["gates", index])?.line;
    if (seen.has(g.id)) {
      const first = seen.get(g.id);
      diags.push(policyDiag(at, "policy.duplicate_gate", ["gates", index, "id"], `${gateLabel(g, index)}: gate id "${g.id}" is already used${first ? ` on line ${first}` : ""}`, { hint: "give every gate a unique id" }));
      return;
    }
    seen.set(g.id, line);
    const op = OPS.find((o) => g[o] !== undefined);
    gates.push({
      id: g.id,
      index,
      metric: typeof g.metric === "string" ? g.metric : undefined,
      expr: typeof g.expr === "string" ? g.expr : undefined,
      where: typeof g.where === "string" ? g.where : undefined,
      op,
      expected: op ? g[op] : undefined,
      severity: g.severity === "warning" ? "warning" : "blocking",
      message: typeof g.message === "string" ? g.message : undefined,
      line,
    });
  });

  const requires =
    raw.requires && typeof raw.requires === "object" && typeof raw.requires.catalog === "string"
      ? { catalog: raw.requires.catalog as string, ...(typeof raw.requires.version === "string" ? { version: raw.requires.version as string } : {}) }
      : undefined;
  const policy: Policy = {
    id: typeof raw.policy === "string" ? raw.policy : "",
    requires,
    gates,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    source,
    locate,
  };
  return { policy, diagnostics: diags };
}

function segments(v: string): number[] {
  return v.split(".").map(Number);
}

function compareVersions(a: string, b: string): number {
  const x = segments(a);
  const y = segments(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Does a catalog version satisfy a `requires.version` range such as ">=1 <4"? */
export function satisfiesVersion(version: number | string, range: string): boolean {
  const v = String(version);
  const comparators = range.match(/(>=|<=|>|<|=)?\s*[0-9]+(?:\.[0-9]+)*/g) ?? [];
  return comparators.every((c) => {
    const m = c.match(/^(>=|<=|>|<|=)?\s*(.+)$/)!;
    const cmp = compareVersions(v, m[2]);
    switch (m[1]) {
      case ">=": return cmp >= 0;
      case "<=": return cmp <= 0;
      case ">": return cmp > 0;
      case "<": return cmp < 0;
      default: return cmp === 0;
    }
  });
}


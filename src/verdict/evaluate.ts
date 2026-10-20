import type { Diagnostic } from "../contract";
import { VERSION } from "../version";
import { CORE_CATALOG } from "./catalog";
import type { Catalog } from "./catalog";
import { compileExpr, evalExpr, ExprEvalError, makeFacts } from "./expr";
import type { PackFacts, CatalogProvenance } from "./facts";
import { checkPolicy } from "./lint";
import { countTotals, failureRows, resolveMetric, testFact } from "./metrics";
import type { MetricValue, Trust } from "./metrics";
import type { Gate, GateSeverity, Op, Policy } from "./policy";

export type VerdictResult = "pass" | "fail" | "errored";
export type GateStatus = "pass" | "fail" | "warn" | "errored";

export interface VerdictError {
  code: string;
  message: string;
  hint: string | null;
}

/** One gate's outcome, as written into the verdict (verdict.schema.json). */
export interface GateResult {
  id: string;
  metric?: string;
  expr?: string;
  where: string | null;
  op: Op | "expr";
  expected: unknown;
  actual: unknown;
  severity: GateSeverity;
  status: GateStatus;
  trust: Trust | null;
  message: string | null;
  error: VerdictError | null;
  stored: MetricValue | null;
}

/** One policy judged against one pack: the <policy-id>.verdict.json document. */
export interface VerdictDoc {
  result: VerdictResult;
  evaluated_at: string;
  evaluator: string;
  pack: { run_id: string | null; sha256: string | null; contract: string | null };
  policy: { id: string; sha256: string };
  catalog: CatalogProvenance | null;
  error: VerdictError | null;
  gates: GateResult[];
  failed_gates: string[];
  warnings: string[];
  errored_gates: string[];
  exit_code: 0 | 1 | 3;
}

export const EVALUATOR = `evidence-cli ${VERSION}`;

export const EXIT_CODES: Record<VerdictResult, 0 | 1 | 3> = { pass: 0, fail: 1, errored: 3 };

function toError(d: Pick<Diagnostic, "code" | "message" | "hint">): VerdictError {
  return { code: d.code, message: d.message, hint: d.hint ?? null };
}

function compare(op: Op, expected: unknown, actual: MetricValue): boolean {
  switch (op) {
    case "equals": return actual === expected;
    case "min": return (actual as number) >= (expected as number);
    case "max": return (actual as number) <= (expected as number);
    case "range": {
      const [lo, hi] = expected as [number, number];
      return (actual as number) >= lo && (actual as number) <= hi;
    }
    case "in": return (expected as unknown[]).includes(actual);
  }
}

function passOrFail(ok: boolean, severity: GateSeverity): GateStatus {
  if (ok) return "pass";
  return severity === "blocking" ? "fail" : "warn";
}

function metricGate(gate: Gate, pack: PackFacts, catalogs: Catalog[]): GateResult {
  const base = {
    id: gate.id,
    metric: gate.metric!,
    where: gate.where ?? null,
    op: gate.op!,
    expected: gate.expected,
    severity: gate.severity,
    message: gate.message ?? null,
  };
  const r = resolveMetric(gate.metric!, pack, catalogs, gate.where);
  if ("error" in r) {
    return { ...base, actual: r.actual, status: "errored", trust: r.trust, error: toError(r.error), stored: r.stored };
  }
  return { ...base, actual: r.value, status: passOrFail(compare(gate.op!, gate.expected, r.value), gate.severity), trust: r.trust, error: null, stored: null };
}

function exprGate(gate: Gate, pack: PackFacts): GateResult {
  const base = { id: gate.id, expr: gate.expr!, where: null, op: "expr" as const, expected: true, severity: gate.severity, message: gate.message ?? null, stored: null };
  const errored = (code: string, message: string, hint?: string): GateResult => ({
    ...base, actual: null, status: "errored", trust: null, error: { code, message, hint: hint ?? null },
  });
  const c = compileExpr(gate.expr!, "pack");
  if (!("run" in c)) return errored(c.code, c.message, c.hint);
  const tests = pack.tests.map(testFact);
  let value: unknown;
  try {
    value = evalExpr(c, makeFacts({ run: pack.run ?? {}, tests, totals: countTotals(tests), failures: failureRows(pack) }));
  } catch (e) {
    if (e instanceof ExprEvalError) return errored(e.code, e.message);
    throw e;
  }
  if (typeof value !== "boolean") return errored("verdict.expr_error", `expr gave ${JSON.stringify(value)}, not a bool`);
  return { ...base, actual: value, status: passOrFail(value, gate.severity), trust: "recomputed", error: null };
}

function packProblem(pack: PackFacts): VerdictError | null {
  if (pack.status !== "finalized") {
    return { code: "verdict.unfinalized", message: `the pack is ${pack.status ?? "unreadable"}, not finalized; only a sealed pack can be judged`, hint: "run evidence finalize first" };
  }
  if (!pack.validation.valid) {
    const errors = pack.validation.diagnostics.filter((d) => d.severity === "error");
    const first = errors[0];
    return {
      code: "verdict.pack_invalid",
      message: `the pack fails L0 validation with ${errors.length} error(s)${first ? `; first: ${first.location}: ${first.message} [${first.code}]` : ""}`,
      hint: "run evidence validate on the pack",
    };
  }
  return null;
}

/**
 * Judge one pack against one loaded policy (decision 0047). The pack must be
 * finalized and L0-valid, and the policy must check clean against the pack's
 * catalog; otherwise the whole verdict is errored with the first problem.
 * Each gate then resolves and compares. Pure: the same facts, policy and
 * evaluatedAt give the same document.
 */
export function judge(
  pack: PackFacts,
  policy: Policy,
  catalogs: Catalog[] = pack.catalog ? [CORE_CATALOG, pack.catalog] : [CORE_CATALOG],
  opts: { evaluatedAt?: string } = {},
): VerdictDoc {
  const producer = catalogs.find((c) => !c.builtin) ?? null;
  const doc: VerdictDoc = {
    result: "pass",
    evaluated_at: opts.evaluatedAt ?? new Date().toISOString(),
    evaluator: EVALUATOR,
    pack: { run_id: pack.runId, sha256: pack.sha256, contract: pack.contract },
    policy: { id: policy.id, sha256: policy.sha256 },
    catalog: pack.catalogProvenance,
    error: null,
    gates: [],
    failed_gates: [],
    warnings: [],
    errored_gates: [],
    exit_code: 0,
  };

  const problems = checkPolicy(policy, { catalog: producer, pack: true }).filter((d) => d.severity === "error");
  const whole =
    packProblem(pack) ??
    (problems.length > 0
      ? toError({
          code: problems[0].code,
          message: problems.length === 1 ? problems[0].message : `${problems.length} policy problems against this pack: ${problems.map((d) => `${d.message} [${d.code}]`).join("; ")}`,
          hint: problems[0].hint,
        })
      : null);
  if (whole) {
    doc.error = whole;
    doc.result = "errored";
    doc.exit_code = EXIT_CODES.errored;
    return doc;
  }

  for (const gate of policy.gates) {
    const g = gate.expr !== undefined ? exprGate(gate, pack) : metricGate(gate, pack, catalogs);
    doc.gates.push(g);
    if (g.status === "fail") doc.failed_gates.push(g.id);
    if (g.status === "warn") doc.warnings.push(g.id);
    if (g.status === "errored") doc.errored_gates.push(g.id);
  }
  doc.result = doc.errored_gates.length > 0 ? "errored" : doc.failed_gates.length > 0 ? "fail" : "pass";
  doc.exit_code = EXIT_CODES[doc.result];
  return doc;
}

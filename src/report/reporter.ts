import pc from "picocolors";
import type { Diagnostic, ValidationReport, FinalizeResult, MergeReport, Severity } from "../contract";
import type { GateResult, VerdictDoc } from "../verdict/evaluate";

/** The lint outcome for one policy file. */
export interface LintResult {
  source: string;
  valid: boolean;
  diagnostics: Diagnostic[];
}

export interface Reporter {
  validation(report: ValidationReport): void;
  finalize(result: FinalizeResult): void;
  merge(report: MergeReport): void;
  verdicts(docs: VerdictDoc[], files: string[]): void;
  lint(results: LintResult[]): void;
  usageError(message: string): void;
}

export class JsonReporter implements Reporter {
  validation(report: ValidationReport): void {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
  finalize(result: FinalizeResult): void {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
  merge(report: MergeReport): void {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
  verdicts(docs: VerdictDoc[]): void {
    process.stdout.write(JSON.stringify(docs, null, 2) + "\n");
  }
  lint(results: LintResult[]): void {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  }
  usageError(message: string): void {
    process.stderr.write(JSON.stringify({ error: message }, null, 2) + "\n");
  }
}

type Marker = Severity | "ok";

export class HumanReporter implements Reporter {
  private readonly color: boolean;
  constructor(private readonly isTty: boolean) {
    this.color = isTty && !process.env.NO_COLOR;
  }

  private sym(m: Marker): string {
    if (this.isTty) return m === "error" ? "✗" : m === "warning" ? "⚠" : "✓";
    return m === "error" ? "x" : m === "warning" ? "!" : "ok";
  }

  private paint(s: string, m: Marker): string {
    if (!this.color) return s;
    return m === "error" ? pc.red(s) : m === "warning" ? pc.yellow(s) : pc.green(s);
  }

  validation(report: ValidationReport): void {
    const errors = report.diagnostics.filter((d) => d.severity === "error");
    const warnings = report.diagnostics.filter((d) => d.severity === "warning");
    for (const d of report.diagnostics) {
      const line = `${this.sym(d.severity)} ${d.location}: ${d.message} [${d.code}]`;
      process.stdout.write(this.paint(line, d.severity) + "\n");
    }
    const where = `profile ${report.profile}, evidence ${report.version}, status ${report.status ?? "unknown"}`;
    if (report.valid) {
      process.stdout.write(this.paint(`${this.sym("ok")} valid (${where})`, "ok") + "\n");
    } else {
      process.stdout.write(this.paint(`${this.sym("error")} invalid — ${errors.length} error(s), ${warnings.length} warning(s) (${where})`, "error") + "\n");
    }
  }

  finalize(result: FinalizeResult): void {
    const t = result.totals;
    process.stdout.write(this.paint(`${this.sym("ok")} sealed ${result.sealedPath}`, "ok") + "\n");
    process.stdout.write(`  totals: tests=${t.tests} passed=${t.passed} failed=${t.failed} broken=${t.broken} skipped=${t.skipped}\n`);
  }

  merge(report: MergeReport): void {
    for (const s of report.packs.skipped) {
      process.stdout.write(this.paint(`${this.sym("warning")} skipped pack "${s.runId}": ${s.reason} [${s.rule}]`, "warning") + "\n");
    }
    for (const c of report.tests.collisions) {
      let outcome: string;
      if (c.action === "nest") outcome = `nested into ${c.folder}, latest ${c.winner}`;
      else if (c.action === "split") outcome = `split into ${c.folder}`;
      else outcome = c.winner ? `winner ${c.winner}` : "discarded";
      process.stdout.write(`  collision ${c.test}: ${outcome} [${c.rule}]\n`);
    }
    if (report.tests.discarded.length > 0) {
      process.stdout.write(this.paint(`${this.sym("warning")} discarded tests: ${report.tests.discarded.join(", ")}`, "warning") + "\n");
    }
    const sealed = report.output.finalized ? ", sealed" : "";
    process.stdout.write(
      this.paint(`${this.sym("ok")} merged ${report.output.path} (run_id ${report.output.runId}, ${report.tests.merged} test(s)${sealed})`, "ok") + "\n",
    );
  }

  verdicts(docs: VerdictDoc[], files: string[]): void {
    docs.forEach((doc, i) => {
      const m: Marker = doc.result === "pass" ? "ok" : "error";
      const to = files[i] ? ` -> ${files[i]}` : "";
      if (doc.error) {
        process.stdout.write(this.paint(`${this.sym(m)} ${doc.policy.id}: errored — ${doc.error.message} [${doc.error.code}]${to}`, m) + "\n");
        if (doc.error.hint) process.stdout.write(`    -> ${doc.error.hint}\n`);
        return;
      }
      const n = (s: GateResult["status"]) => doc.gates.filter((g) => g.status === s).length;
      const counts = `${doc.gates.length} gate(s): ${n("pass")} pass, ${n("fail")} fail, ${n("warn")} warn, ${n("errored")} errored`;
      process.stdout.write(this.paint(`${this.sym(m)} ${doc.policy.id}: ${doc.result} — ${counts}${to}`, m) + "\n");
      for (const g of doc.gates) {
        if (g.status === "pass") continue;
        const gm: Marker = g.status === "warn" ? "warning" : "error";
        const subject = g.metric !== undefined ? `${g.metric}${g.where ? ` where ${g.where}` : ""}` : g.expr;
        const detail = g.error
          ? `errored — ${g.error.message} [${g.error.code}]`
          : g.op === "expr"
            ? "is false"
            : `${g.op} ${JSON.stringify(g.expected)}, actual ${JSON.stringify(g.actual)}`;
        process.stdout.write(this.paint(`  ${this.sym(gm)} ${g.id}: ${subject} ${detail}`, gm) + "\n");
        if (g.message) process.stdout.write(`      ${g.message}\n`);
      }
    });
  }

  lint(results: LintResult[]): void {
    for (const r of results) {
      const errors = r.diagnostics.filter((d) => d.severity === "error").length;
      const warnings = r.diagnostics.length - errors;
      const head = r.valid
        ? `${this.sym("ok")} ${r.source} — no problems${warnings ? `, ${warnings} warning(s)` : ""}`
        : `${this.sym("error")} ${r.source} — ${errors} problem(s)${warnings ? `, ${warnings} warning(s)` : ""}`;
      process.stdout.write(this.paint(head, r.valid ? "ok" : "error") + "\n");
      for (const d of r.diagnostics) {
        const at = d.line ? `line ${d.line}: ` : "";
        process.stdout.write(this.paint(`  ${this.sym(d.severity)} ${at}${d.message} [${d.code}]`, d.severity) + "\n");
        if (d.hint) process.stdout.write(`      -> ${d.hint}\n`);
      }
    }
  }

  usageError(message: string): void {
    process.stderr.write(this.paint(`${this.sym("error")} ${message}`, "error") + "\n");
  }
}

export function makeReporter(json: boolean): Reporter {
  return json ? new JsonReporter() : new HumanReporter(Boolean(process.stdout.isTTY));
}

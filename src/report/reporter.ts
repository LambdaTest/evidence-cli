import pc from "picocolors";
import type { ValidationReport, FinalizeResult, MergeReport, Severity } from "../contract";

export interface Reporter {
  validation(report: ValidationReport): void;
  finalize(result: FinalizeResult): void;
  merge(report: MergeReport): void;
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

  usageError(message: string): void {
    process.stderr.write(this.paint(`${this.sym("error")} ${message}`, "error") + "\n");
  }
}

export function makeReporter(json: boolean): Reporter {
  return json ? new JsonReporter() : new HumanReporter(Boolean(process.stdout.isTTY));
}

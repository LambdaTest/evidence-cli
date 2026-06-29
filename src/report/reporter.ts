import pc from "picocolors";
import type { ValidationReport, FinalizeResult, Severity } from "../contract";

export interface Reporter {
  validation(report: ValidationReport): void;
  finalize(result: FinalizeResult): void;
  usageError(message: string): void;
}

export class JsonReporter implements Reporter {
  validation(report: ValidationReport): void {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
  finalize(result: FinalizeResult): void {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
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

  usageError(message: string): void {
    process.stderr.write(this.paint(`${this.sym("error")} ${message}`, "error") + "\n");
  }
}

export function makeReporter(json: boolean): Reporter {
  return json ? new JsonReporter() : new HumanReporter(Boolean(process.stdout.isTTY));
}

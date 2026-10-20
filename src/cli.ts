#!/usr/bin/env node
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { validate } from "./validate";
import { finalize } from "./finalize";
import { merge } from "./merge";
import { loadConfig, resolveProfile } from "./config";
import { makeReporter } from "./report/reporter";
import type { LintResult } from "./report/reporter";
import { combinedExitCode, PolicyUsageError, verdict, writeVerdicts } from "./verdict";
import { CatalogLoadError, loadCatalog } from "./verdict/catalog";
import type { Catalog } from "./verdict/catalog";
import { lintPolicy } from "./verdict/lint";
import { VERSION } from "./version";

const program = new Command();
program
  .name("evidence")
  .description("Validate, finalize, merge and judge .evidence packs")
  .version(VERSION);

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function readInput(file: string, what: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    const e = new Error(`cannot read ${what} "${file}"`) as Error & { code?: string };
    e.code = "USAGE";
    throw e;
  }
}

// Route commander's own failures (e.g. a missing required --run-id) through
// the usage exit code (2); help/version display stays exit 0. Must be set
// BEFORE subcommands are defined — each .command() copies settings at creation.
program.exitOverride();

program
  .command("validate")
  .argument("<target>", "a <name>.evidence directory or a sealed .evidence zip")
  .option("--profile <profile>", "validation profile (overrides config)")
  .option("--config <path>", "path to config.json")
  .option("--json", "machine-readable output", false)
  .action(async (target: string, opts: { profile?: string; config?: string; json: boolean }) => {
    const reporter = makeReporter(opts.json);
    try {
      const config = await loadConfig(opts.config);
      const profile = resolveProfile(opts.profile, config);
      const report = await validate(target, { profile });
      reporter.validation(report);
      process.exit(report.valid ? 0 : 1);
    } catch (e: any) {
      reporter.usageError(e?.message ?? String(e));
      process.exit(2);
    }
  });

program
  .command("finalize")
  .argument("<dir>", "the live <name>.evidence/ directory")
  .option("--config <path>", "path to config.json")
  .option("--json", "machine-readable output", false)
  .action(async (dir: string, opts: { config?: string; json: boolean }) => {
    const reporter = makeReporter(opts.json);
    try {
      const result = await finalize(dir, { endedAt: new Date().toISOString() });
      reporter.finalize(result);
      process.exit(0);
    } catch (e: any) {
      reporter.usageError(e?.message ?? String(e));
      process.exit(2);
    }
  });

program
  .command("merge")
  .argument("<packs...>", "two or more packs (sealed .evidence zips or live directories), order-significant")
  .requiredOption("--run-id <id>", "run_id for the merged pack (identity is the caller's fact)")
  .requiredOption("-o, --out <path>", "output live <name>.evidence directory")
  .option("--rules <path>", "merge-rules.yaml policy file (strict defaults when omitted)")
  .option("--title <title>", "merged run title (default: first eligible pack's)")
  .option("--finalize", "seal the merged pack with ended = max(source ended)", false)
  .option("--json", "machine-readable output", false)
  .action(async (packs: string[], opts: { runId: string; out: string; rules?: string; title?: string; finalize: boolean; json: boolean }) => {
    const reporter = makeReporter(opts.json);
    try {
      const report = await merge(packs, {
        runId: opts.runId,
        out: opts.out,
        rulesPath: opts.rules,
        title: opts.title,
        finalize: opts.finalize,
      });
      reporter.merge(report);
      process.exit(0);
    } catch (e: any) {
      reporter.usageError(e?.message ?? String(e));
      process.exit(e?.code === "ABORT" ? 1 : 2);
    }
  });

program
  .command("verdict")
  .argument("[pack]", "a sealed .evidence zip (or a finalized directory) to judge; omit with --lint")
  .option("--policy <file>", "policy YAML; repeat for several policies", collect, [])
  .option("-o, --out <dir>", "directory for <policy-id>.verdict.json (default: the pack's directory)")
  .option("--lint", "only check the policies, against --catalog if given; no pack", false)
  .option("--catalog <file>", "metric catalog to check policies against (with --lint)")
  .option("--json", "machine-readable output", false)
  .action(async (pack: string | undefined, opts: { policy: string[]; out?: string; lint: boolean; catalog?: string; json: boolean }) => {
    const reporter = makeReporter(opts.json);
    try {
      if (opts.policy.length === 0) throw Object.assign(new Error("at least one --policy <file> is required"), { code: "USAGE" });
      if (opts.lint) {
        if (pack) throw Object.assign(new Error("--lint checks policies only; drop the pack argument"), { code: "USAGE" });
        let catalog: Catalog | null = null;
        if (opts.catalog) catalog = loadCatalog(await readInput(opts.catalog, "catalog"));
        const results: LintResult[] = [];
        for (const file of opts.policy) {
          const diagnostics = lintPolicy(await readInput(file, "policy"), { catalog, source: file });
          results.push({ source: file, valid: !diagnostics.some((d) => d.severity === "error"), diagnostics });
        }
        reporter.lint(results);
        process.exit(results.every((r) => r.valid) ? 0 : 1);
      }
      if (!pack) throw Object.assign(new Error("a pack is required (or pass --lint)"), { code: "USAGE" });
      if (opts.catalog) throw Object.assign(new Error("--catalog is only used with --lint; a verdict reads the pack's own catalog"), { code: "USAGE" });
      const policies = [];
      for (const file of opts.policy) policies.push({ content: await readInput(file, "policy"), path: file });
      const docs = await verdict(pack, { policies });
      const files = await writeVerdicts(docs, opts.out ?? path.dirname(path.resolve(pack)));
      reporter.verdicts(docs, files);
      process.exit(combinedExitCode(docs));
    } catch (e: any) {
      if (e instanceof PolicyUsageError && e.problems.length > 0) {
        reporter.lint(e.problems.map((p) => ({ source: p.source, valid: false, diagnostics: p.diagnostics })));
      } else if (e instanceof CatalogLoadError) {
        reporter.lint([{ source: opts.catalog ?? "catalog", valid: false, diagnostics: e.diagnostics }]);
      }
      reporter.usageError(e?.message ?? String(e));
      process.exit(2);
    }
  });

program.parseAsync(process.argv).catch((e: any) => {
  if (e?.code === "commander.helpDisplayed" || e?.code === "commander.version" || e?.code === "commander.help") {
    process.exit(0);
  }
  if (typeof e?.code !== "string" || !e.code.startsWith("commander.")) {
    process.stderr.write(String(e) + "\n");
  }
  process.exit(2);
});

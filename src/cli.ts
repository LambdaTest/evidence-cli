#!/usr/bin/env node
import { Command } from "commander";
import { validate } from "./validate";
import { finalize } from "./finalize";
import { merge } from "./merge";
import { loadConfig, resolveProfile } from "./config";
import { makeReporter } from "./report/reporter";

const program = new Command();
program
  .name("evidence")
  .description("Validate and finalize .evidence packs")
  .version("0.1.0");

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

program.parseAsync(process.argv).catch((e: any) => {
  if (e?.code === "commander.helpDisplayed" || e?.code === "commander.version" || e?.code === "commander.help") {
    process.exit(0);
  }
  if (typeof e?.code !== "string" || !e.code.startsWith("commander.")) {
    process.stderr.write(String(e) + "\n");
  }
  process.exit(2);
});

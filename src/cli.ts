#!/usr/bin/env node
import { Command } from "commander";
import { validate } from "./validate";
import { finalize } from "./finalize";
import { loadConfig, resolveProfile } from "./config";
import { makeReporter } from "./report/reporter";

const program = new Command();
program
  .name("evidence")
  .description("Validate and finalize .evidence packs")
  .version("0.1.0");

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

program.parseAsync(process.argv).catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(2);
});

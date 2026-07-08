import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { finalize } from "../finalize";
import { parseYaml } from "../yaml";

/**
 * Test staging helpers for the merge suite. stagePack builds a schema-valid
 * LIVE pack (status: running) in a tmp dir; sealCopy runs the real finalize on
 * a copy, using the staged run.yaml's `ended` (if any) as the seal timestamp.
 */
export interface StageTestSpec {
  status?: string; // test verdict; the 2-pay step carries the same status
  environment?: any; // result-level environment block
  failure?: string; // content of steps/2-pay/failure.yaml
}

export interface StagePackSpec {
  runId: string;
  status?: string; // default "running" (a live pack)
  started?: string;
  ended?: string; // consumed by sealCopy as finalize's endedAt
  title?: string;
  environment?: any;
  metrics?: any;
  l1?: boolean; // add logs/steps/coverage artifacts (L1 shape)
  tests?: Record<string, StageTestSpec>;
}

const TEST_MD = "# Test\nA staged test definition.\n";

export async function stagePack(spec: StagePackSpec): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-mergekit-"));
  const dir = path.join(tmp, `${spec.runId}.evidence`);
  const tests = spec.tests ?? { checkout: {} };

  let run = `evidence: "0.1"\nrun_id: ${spec.runId}\nstatus: ${spec.status ?? "running"}\ntitle: ${spec.title ?? `t-${spec.runId}`}\nstarted: ${spec.started ?? "2026-07-08T08:00:00Z"}\n`;
  if (spec.ended) run += `ended: ${spec.ended}\n`;
  if (spec.environment) run += `environment: ${JSON.stringify(spec.environment)}\n`;
  if (spec.metrics) run += `metrics: ${JSON.stringify(spec.metrics)}\n`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "run.yaml"), run);

  for (const [id, t] of Object.entries(tests)) {
    const testDir = path.join(dir, "tests", id);
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, "test.md"), TEST_MD);
    const status = t.status ?? "passed";
    let result = `evidence: "0.1"\ntest: ${id}\nstatus: ${status}\ndefinition:\n  path: test.md\nsteps:\n  - { id: open, ordinal: 1, status: passed }\n  - { id: pay, ordinal: 2, status: ${status} }\n`;
    if (t.environment) result += `environment: ${JSON.stringify(t.environment)}\n`;
    await fs.writeFile(path.join(testDir, "result.yaml"), result);

    if (spec.l1) {
      const logs = path.join(testDir, "logs");
      await fs.mkdir(logs, { recursive: true });
      await fs.writeFile(path.join(logs, "meta.yaml"), "logs:\n  - { name: console, file: console.ndjson, format: ndjson }\n");
      await fs.writeFile(path.join(logs, "console.ndjson"), '{"level":"info"}\n');
      for (const step of ["1-open", "2-pay"]) {
        const stepDir = path.join(testDir, "steps", step);
        await fs.mkdir(stepDir, { recursive: true });
        await fs.writeFile(path.join(stepDir, "screenshot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      }
    }
    if (t.failure) {
      const stepDir = path.join(testDir, "steps", "2-pay");
      await fs.mkdir(stepDir, { recursive: true });
      await fs.writeFile(path.join(stepDir, "failure.yaml"), t.failure);
    }
  }

  if (spec.l1) {
    const cov = path.join(dir, "coverage");
    await fs.mkdir(cov, { recursive: true });
    await fs.writeFile(path.join(cov, "lcov.info"), "TN:\nend_of_record\n");
  }
  return dir;
}

/** Seal a COPY of a staged live pack with the real finalize; returns the sealed zip path. */
export async function sealCopy(dir: string): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-mergekit-seal-"));
  const copy = path.join(tmp, path.basename(dir));
  await fs.cp(dir, copy, { recursive: true });
  const run = parseYaml(await fs.readFile(path.join(copy, "run.yaml"), "utf8")) as any;
  const endedAt = typeof run?.ended === "string" ? run.ended : "2026-07-08T09:01:00Z";
  await finalize(copy, { endedAt });
  return copy; // finalize sealed in place: the path is now a zip file
}

/** Write a merge-rules.yaml into a tmp dir; returns its path. */
export async function writeRules(yaml: string): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-mergekit-rules-"));
  const p = path.join(tmp, "merge-rules.yaml");
  await fs.writeFile(p, yaml);
  return p;
}

/** SHA-256 of the staged definition, for assertions on copied trees. */
export function definitionSha(): string {
  return `sha256:${createHash("sha256").update(TEST_MD).digest("hex")}`;
}

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Diagnostic } from "../contract";
import { judge } from "./evaluate";
import type { VerdictDoc } from "./evaluate";
import { loadPackFacts } from "./facts";
import type { PackFacts } from "./facts";
import { loadPolicy } from "./policy";
import type { Policy } from "./policy";

export interface PolicyInput {
  /** the exact policy YAML text */
  content: string;
  /** where it came from, used in diagnostic locations */
  path?: string;
}

export interface VerdictOptions {
  policies: PolicyInput[];
  /** RFC3339 timestamp for evaluated_at (default: now) */
  evaluatedAt?: string;
}

/** The policies could not be read; nothing was judged. CLI exit 2. */
export class PolicyUsageError extends Error {
  readonly code = "USAGE";
  constructor(message: string, readonly problems: { source: string; diagnostics: Diagnostic[] }[] = []) {
    super(message);
  }
}

function usage(message: string, problems: { source: string; diagnostics: Diagnostic[] }[] = []): never {
  throw new PolicyUsageError(message, problems);
}

/** Load every policy, or throw PolicyUsageError listing every structural problem. */
export function loadPolicies(inputs: PolicyInput[]): Policy[] {
  if (inputs.length === 0) usage("at least one policy is required");
  const policies: Policy[] = [];
  const problems: { source: string; diagnostics: Diagnostic[] }[] = [];
  inputs.forEach((input, i) => {
    const source = input.path ?? `policy[${i}]`;
    const { policy, diagnostics } = loadPolicy(input.content, { source });
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (!policy || errors.length > 0) problems.push({ source, diagnostics: errors });
    else policies.push(policy);
  });
  if (problems.length > 0) {
    const count = problems.reduce((n, p) => n + p.diagnostics.length, 0);
    usage(`${count} problem(s) in ${problems.length} policy file(s); nothing was judged`, problems);
  }
  const seen = new Set<string>();
  for (const p of policies) {
    if (seen.has(p.id)) usage(`two policies are named "${p.id}"; each verdict is written to <policy-id>.verdict.json, so ids must differ`);
    seen.add(p.id);
  }
  return policies;
}

/**
 * Judge a pack against one or more policies (decision 0047). Reads the pack
 * (live directory or sealed zip) once and returns one VerdictDoc per policy,
 * in the order given. Never writes — the pack is untouched and the caller
 * decides where the verdict files go (writeVerdicts).
 */
export async function verdict(pack: string, opts: VerdictOptions): Promise<VerdictDoc[]> {
  const policies = loadPolicies(opts.policies);
  let facts: PackFacts;
  try {
    facts = await loadPackFacts(pack);
  } catch (e: any) {
    usage(`cannot read pack "${pack}": ${e?.message ?? e}`);
  }
  const evaluatedAt = opts.evaluatedAt ?? new Date().toISOString();
  return policies.map((p) => judge(facts, p, undefined, { evaluatedAt }));
}

/** The sidecar file name for a verdict: <policy-id>.verdict.json. */
export function verdictFileName(doc: Pick<VerdictDoc, "policy">): string {
  return `${doc.policy.id}.verdict.json`;
}

/** Write each verdict as <dir>/<policy-id>.verdict.json; returns the paths. */
export async function writeVerdicts(docs: VerdictDoc[], dir: string): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true });
  const out: string[] = [];
  for (const doc of docs) {
    const file = path.join(dir, verdictFileName(doc));
    await fs.writeFile(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
    out.push(file);
  }
  return out;
}

/** Overall exit code for several verdicts: 3 if any errored, else 1 if any failed, else 0. */
export function combinedExitCode(docs: VerdictDoc[]): 0 | 1 | 3 {
  if (docs.some((d) => d.result === "errored")) return 3;
  if (docs.some((d) => d.result === "fail")) return 1;
  return 0;
}

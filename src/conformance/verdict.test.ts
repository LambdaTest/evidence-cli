import { describe, expect, it } from "vitest";
import { promises as fs, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { loadToolSchema } from "../schemas/compile";
import { PolicyUsageError, verdict } from "../verdict";
import type { VerdictDoc } from "../verdict/evaluate";
import { parseYaml } from "../yaml";
import { toZip } from "./harness";

/**
 * The verdict conformance corpus (decision 0047): each case under
 * fixtures/0.1/verdict/<case>/ holds a pack (pack.evidence/, directory form),
 * the policy.yaml to judge it with, and expected.yaml — the result, the exit
 * code, the whole-verdict error code, and per-gate status/actual/trust/stored/
 * error, or `usage`: the diagnostic codes of the usage error judging throws.
 * Every case runs on the directory and on a sealed zip of it; the two must
 * give the same document apart from pack.sha256 and evaluated_at.
 */
const ROOT = path.resolve(__dirname, "../../fixtures/0.1/verdict");
const AT = "2026-10-21T00:00:00.000Z";

interface ExpectedGate {
  status: string;
  actual?: unknown;
  trust?: string;
  stored?: unknown;
  error?: string;
}

interface Expected {
  usage?: string[];
  result: string;
  exit_code: number;
  error: string | null;
  gates: Record<string, ExpectedGate>;
}

const cases = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

function load(name: string): { pack: string; policy: string; expected: Expected } {
  const dir = path.join(ROOT, name);
  return {
    pack: path.join(dir, "pack.evidence"),
    policy: readFileSync(path.join(dir, "policy.yaml"), "utf8"),
    expected: parseYaml(readFileSync(path.join(dir, "expected.yaml"), "utf8")) as Expected,
  };
}

function assertCase(name: string, doc: VerdictDoc, expected: Expected): void {
  expect(doc.result, `${name}: result`).toBe(expected.result);
  expect(doc.exit_code, `${name}: exit_code`).toBe(expected.exit_code);
  expect(doc.error?.code ?? null, `${name}: error`).toBe(expected.error);
  expect(doc.gates.map((g) => g.id), `${name}: gate ids`).toEqual(Object.keys(expected.gates));
  for (const g of doc.gates) {
    const want = expected.gates[g.id];
    expect(g.status, `${name}/${g.id}: status`).toBe(want.status);
    if ("actual" in want) expect(g.actual, `${name}/${g.id}: actual`).toEqual(want.actual);
    if ("trust" in want) expect(g.trust, `${name}/${g.id}: trust`).toBe(want.trust);
    if ("stored" in want) expect(g.stored, `${name}/${g.id}: stored`).toEqual(want.stored);
    if ("error" in want) expect(g.error?.code, `${name}/${g.id}: error`).toBe(want.error);
  }
  const valid = loadToolSchema("verdict");
  expect(valid(JSON.parse(JSON.stringify(doc))), `${name}: schema ${JSON.stringify(valid.errors)}`).toBe(true);
}

function comparable(doc: VerdictDoc): unknown {
  return { ...doc, pack: { ...doc.pack, sha256: null }, evaluated_at: null };
}

describe("verdict conformance corpus", () => {
  it("covers the required cases", () => {
    expect(cases).toEqual(["cel-expr", "errored-stored-mismatch", "fail", "merged", "pass", "unfinalized", "usage-unknown-metric"]);
  });

  it.each(cases)("%s — directory and sealed zip", async (name) => {
    const { pack, policy, expected } = load(name);
    if (expected.usage) {
      for (const target of [pack, await toZip(pack)]) {
        const e = await verdict(target, { policies: [{ content: policy, path: "policy.yaml" }], evaluatedAt: AT }).catch((x: unknown) => x);
        expect(e, `${name}: usage error`).toBeInstanceOf(PolicyUsageError);
        expect((e as PolicyUsageError).problems.flatMap((p) => p.diagnostics.map((d) => d.code)), `${name}: usage codes`).toEqual(expected.usage);
        if (target !== pack) await fs.rm(path.dirname(target), { recursive: true, force: true });
      }
      return;
    }
    const [dirDoc] = await verdict(pack, { policies: [{ content: policy, path: "policy.yaml" }], evaluatedAt: AT });
    assertCase(name, dirDoc, expected);
    expect(dirDoc.pack.sha256).toBeNull();

    const zip = await toZip(pack);
    try {
      const [zipDoc] = await verdict(zip, { policies: [{ content: policy, path: "policy.yaml" }], evaluatedAt: AT });
      assertCase(name, zipDoc, expected);
      expect(zipDoc.pack.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(comparable(zipDoc)).toEqual(comparable(dirDoc));
    } finally {
      await fs.rm(path.dirname(zip), { recursive: true, force: true });
    }
  });
});

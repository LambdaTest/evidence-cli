import { describe, expect, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stagePack, sealCopy } from "../merge/testkit";
import type { VerdictDoc } from "./evaluate";
import { combinedExitCode, PolicyUsageError, verdict, verdictFileName, writeVerdicts } from "./index";

const PASS = "policy: smoke\ngates:\n  - { id: some-tests, metric: totals.tests, min: 1, severity: blocking }\n";
const FAIL = "policy: strict\ngates:\n  - { id: all-pass, metric: totals.failed, equals: 0, severity: blocking }\n";

let sealed: string;
beforeAll(async () => {
  sealed = await sealCopy(await stagePack({ runId: "r1", tests: { a: { status: "passed" }, b: { status: "failed" } } }));
});

describe("verdict()", () => {
  it("judges a pack against several policies, in order", async () => {
    const docs = await verdict(sealed, { policies: [{ content: PASS }, { content: FAIL, path: "strict.yaml" }], evaluatedAt: "2026-10-21T00:00:00Z" });
    expect(docs.map((d) => [d.policy.id, d.result, d.exit_code, d.evaluated_at])).toEqual([
      ["smoke", "pass", 0, "2026-10-21T00:00:00Z"],
      ["strict", "fail", 1, "2026-10-21T00:00:00Z"],
    ]);
    expect(docs[0].pack.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never modifies the pack", async () => {
    const before = await fs.readFile(sealed);
    await verdict(sealed, { policies: [{ content: FAIL }] });
    expect((await fs.readFile(sealed)).equals(before)).toBe(true);
  });

  const usage: { name: string; policies: { content: string; path?: string }[]; pack?: string; match: RegExp; sources?: string[] }[] = [
    { name: "no policies", policies: [], match: /at least one policy/ },
    { name: "a policy that does not parse", policies: [{ content: PASS }, { content: "policy: [", path: "bad.yaml" }], match: /nothing was judged/, sources: ["bad.yaml"] },
    { name: "a policy with an unknown key", policies: [{ content: PASS.replace("min: 1", "minimum: 1"), path: "typo.yaml" }], match: /2 problem/, sources: ["typo.yaml"] },
    { name: "two policies with one id", policies: [{ content: PASS }, { content: PASS }], match: /two policies are named "smoke"/ },
    { name: "an unreadable pack", policies: [{ content: PASS }], pack: "/nonexistent/x.evidence", match: /cannot read pack/ },
  ];
  it.each(usage)("throws a usage error for $name", async ({ policies, pack, match, sources }) => {
    const p = verdict(pack ?? sealed, { policies });
    await expect(p).rejects.toBeInstanceOf(PolicyUsageError);
    await expect(p).rejects.toMatchObject({ code: "USAGE", message: expect.stringMatching(match) });
    if (sources) {
      const e = (await p.catch((x: unknown) => x)) as PolicyUsageError;
      expect(e.problems.map((x) => x.source)).toEqual(sources);
    }
  });
});

describe("writeVerdicts", () => {
  it("writes <policy-id>.verdict.json per verdict into the directory", async () => {
    const docs = await verdict(sealed, { policies: [{ content: PASS }, { content: FAIL }] });
    const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evi-verdict-out-")), "nested");
    const files = await writeVerdicts(docs, dir);
    expect(files).toEqual([path.join(dir, "smoke.verdict.json"), path.join(dir, "strict.verdict.json")]);
    expect(JSON.parse(await fs.readFile(files[1], "utf8"))).toEqual(docs[1]);
    expect(verdictFileName(docs[0])).toBe("smoke.verdict.json");
  });
});

describe("combinedExitCode", () => {
  const doc = (result: VerdictDoc["result"]) => ({ result }) as VerdictDoc;
  const cases: { results: VerdictDoc["result"][]; want: number }[] = [
    { results: ["pass"], want: 0 },
    { results: ["pass", "fail"], want: 1 },
    { results: ["fail", "errored", "pass"], want: 3 },
    { results: [], want: 0 },
  ];
  it.each(cases)("$results → $want", ({ results, want }) => {
    expect(combinedExitCode(results.map(doc))).toBe(want);
  });
});

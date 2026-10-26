import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { validate } from "./index";
import { stagePack, sealCopy } from "../merge/testkit";

const CATALOG = `catalog: kane-cli
version: 3
metrics:
  credits: { type: decimal, verify: stored, merge: sum }
`;

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function packWith(opts: { snapshot?: string; block?: Record<string, unknown> }): Promise<string> {
  const dir = await stagePack({ runId: "r1" });
  if (opts.snapshot !== undefined) {
    await fs.mkdir(path.join(dir, "meta"), { recursive: true });
    await fs.writeFile(path.join(dir, "meta", "metrics-catalog.yaml"), opts.snapshot);
  }
  if (opts.block) {
    await fs.appendFile(path.join(dir, "run.yaml"), `metrics_catalog: ${JSON.stringify(opts.block)}\n`);
  }
  return dir;
}

function codes(report: { diagnostics: { code: string; severity: string }[] }): string[] {
  return report.diagnostics.map((d) => `${d.severity}:${d.code}`);
}

describe("validate — metric catalog snapshot (decision 0048)", () => {
  const good = { id: "kane-cli", version: 3, sha256: sha(CATALOG), source: "controller" };
  const cases: { name: string; snapshot?: string; block?: Record<string, unknown>; want: string[] }[] = [
    { name: "a matching snapshot and block", snapshot: CATALOG, block: good, want: [] },
    { name: "no catalog at all", want: [] },
    { name: "block without a snapshot", block: good, want: ["error:catalog.missing"] },
    { name: "snapshot without a block", snapshot: CATALOG, want: ["warning:catalog.unreferenced"] },
    { name: "snapshot bytes changed", snapshot: CATALOG + "# edited\n", block: good, want: ["error:catalog.hash_mismatch"] },
    { name: "block names another catalog", snapshot: CATALOG, block: { ...good, id: "other" }, want: ["error:catalog.identity_mismatch"] },
    { name: "block names another version", snapshot: CATALOG, block: { ...good, version: 2 }, want: ["error:catalog.identity_mismatch"] },
    { name: "snapshot does not parse", snapshot: "catalog: [", block: { ...good, sha256: sha("catalog: [") }, want: ["error:catalog.parse"] },
    {
      name: "snapshot breaks a catalog rule",
      snapshot: "catalog: kane-cli\nversion: 3\nmetrics:\n  pass_rate: { type: ratio, verify: stored }\n",
      block: { ...good, sha256: sha("catalog: kane-cli\nversion: 3\nmetrics:\n  pass_rate: { type: ratio, verify: stored }\n") },
      want: ["error:catalog.reserved_name"],
    },
    { name: "block with a malformed sha256", snapshot: CATALOG, block: { ...good, sha256: "sha256:abc" }, want: ["error:schema.invalid"] },
  ];
  it.each(cases)("$name", async ({ snapshot, block, want }) => {
    const report = await validate(await packWith({ snapshot, block }));
    expect(codes(report)).toEqual(want);
  });

  it("gives the same outcome on the sealed zip", async () => {
    const dir = await packWith({ snapshot: CATALOG + "# edited\n", block: { id: "kane-cli", version: 3, sha256: sha(CATALOG) } });
    const sealed = await sealCopy(dir);
    expect(codes(await validate(sealed))).toEqual(["error:catalog.hash_mismatch"]);
  });
});

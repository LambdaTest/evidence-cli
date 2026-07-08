import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_RULES, loadRules, getKey, deepEqual, violates } from "./rules";

describe("loadRules", () => {
  it("returns strict defaults when no path given", async () => {
    expect(await loadRules()).toEqual(DEFAULT_RULES);
    expect(DEFAULT_RULES.packs).toEqual({ require_status: "finalized", require_valid: "L0", on_ineligible: "abort" });
    expect(DEFAULT_RULES.tests).toEqual({ on_collision: "error" });
    expect(DEFAULT_RULES.rules).toEqual([]);
  });

  it("merges a partial file over defaults and validates shape", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-rules-"));
    const p = path.join(tmp, "r.yaml");
    await fs.writeFile(p, "tests: { on_collision: prefer_latest }\nrules:\n  - { file: run.yaml, key: run_id, must: different, on_violation: skip }\n");
    const r = await loadRules(p);
    expect(r.packs.on_ineligible).toBe("abort"); // default preserved
    expect(r.tests.on_collision).toBe("prefer_latest");
    expect(r.rules).toHaveLength(1);
  });

  it("rejects bad YAML, bad shape, and scope/action mismatch as USAGE", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-rules-"));
    const cases = [
      "packs: [unclosed", // parse
      "tests: { on_collision: newest }", // enum
      "rules: [{ file: run.yaml, key: k, must: same, on_violation: prefer_latest }]", // pack rule w/ collision action
      "rules: [{ file: result.yaml, key: k, must: same, on_violation: abort }]", // collision rule w/ pack action
    ];
    for (const [i, c] of cases.entries()) {
      const p = path.join(tmp, `bad-${i}.yaml`);
      await fs.writeFile(p, c);
      await expect(loadRules(p)).rejects.toMatchObject({ code: "USAGE" });
    }
  });
});

describe("helpers", () => {
  it("getKey walks dot paths; undefined for absent", () => {
    expect(getKey({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(getKey({ a: {} }, "a.b")).toBeUndefined();
    expect(getKey(null, "a")).toBeUndefined();
  });

  it("deepEqual is canonical", () => {
    expect(deepEqual({ x: 1, y: [1, 2] }, { y: [1, 2], x: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });

  it("violates pins absent-key semantics", () => {
    expect(violates("same", undefined, undefined)).toBe(false); // absent==absent → same
    expect(violates("same", undefined, "x")).toBe(true); // absent vs present → different
    expect(violates("different", "x", "x")).toBe(true);
    expect(violates("different", undefined, "x")).toBe(false);
  });
});

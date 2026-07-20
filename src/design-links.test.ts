import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseYaml } from "./yaml";

/**
 * The design viewer (design/web) is generated from this metadata, not from the
 * prose: `governs` is reverse-indexed into the "shaped by" chips on the spec
 * page, and `feature` attaches a decision to its spec-area node. A decision
 * that omits them still renders in the decisions log but silently disappears
 * from every other view — which is invisible until someone goes looking.
 */
const DECISIONS_DIR = path.join(__dirname, "..", "design", "decisions");

async function decisionFiles(): Promise<string[]> {
  const entries = await fs.readdir(DECISIONS_DIR);
  return entries.filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
}

async function frontmatterOf(file: string): Promise<any> {
  const raw = await fs.readFile(path.join(DECISIONS_DIR, file), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`${file}: no frontmatter block`);
  return parseYaml(m[1]);
}

describe("decision frontmatter", () => {
  it("every decision declares what it governs and which feature it belongs to", async () => {
    const missing: string[] = [];
    for (const file of await decisionFiles()) {
      const fm = await frontmatterOf(file);
      const governs = Array.isArray(fm?.governs) ? fm.governs : [];
      const feature = Array.isArray(fm?.feature) ? fm.feature : [];
      if (governs.length === 0) missing.push(`${file}: governs`);
      if (feature.length === 0) missing.push(`${file}: feature`);
    }
    expect(missing).toEqual([]);
  });

  it("every governed PATH still exists in the repo", async () => {
    const repoRoot = path.join(__dirname, "..");
    const broken: string[] = [];
    for (const file of await decisionFiles()) {
      const fm = await frontmatterOf(file);
      for (const g of Array.isArray(fm?.governs) ? fm.governs : []) {
        if (typeof g !== "string") continue;
        // A governs entry may be a conceptual AREA ("repo") rather than a path
        // — only path-shaped entries are checkable against the filesystem.
        if (!g.includes("/")) continue;
        const target = g.split("#")[0]; // a JSON-pointer suffix addresses a key, not a file
        await fs.access(path.join(repoRoot, target)).catch(() => {
          broken.push(`${file}: ${target}`);
        });
      }
    }
    expect(broken).toEqual([]);
  });
});

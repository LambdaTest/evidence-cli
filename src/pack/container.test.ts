import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { openContainer } from "./container";

const SMOKE = path.resolve(__dirname, "../../fixtures/0.1/L0/valid/smoke.evidence");

async function makeZip(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evi-zip-"));
  const zipPath = path.join(dir, "smoke.evidence");
  const zip = new AdmZip();
  zip.addLocalFolder(SMOKE); // flat: entries are the directory's contents
  zip.writeZip(zipPath);
  return zipPath;
}

describe("PackContainer parity", () => {
  let zipPath: string;

  it("reads a directory and a flat zip identically", async () => {
    zipPath = await makeZip();
    const dir = await openContainer(SMOKE);
    const zip = await openContainer(zipPath);

    expect(dir.kind).toBe("directory");
    expect(zip.kind).toBe("zip");

    expect(await dir.listTestIds()).toEqual(["checkout", "login"]);
    expect(await zip.listTestIds()).toEqual(["checkout", "login"]);

    expect(await dir.readManifest()).toEqual(await zip.readManifest());
    expect(await dir.readResult("checkout")).toEqual(await zip.readResult("checkout"));

    expect(await dir.fileExists("checkout", "test.md")).toBe(true);
    expect(await zip.fileExists("checkout", "test.md")).toBe(true);

    const a = await dir.readBytes("checkout", "test.md");
    const b = await zip.readBytes("checkout", "test.md");
    expect(a && b && a.equals(b)).toBe(true);

    expect(dir.name).toBe("smoke");
    expect(zip.name).toBe("smoke");
  });

  afterAll(async () => {
    if (zipPath) await fs.rm(path.dirname(zipPath), { recursive: true, force: true });
  });
});

describe("PackContainer primitives (dir == zip)", () => {
  let zipPath: string;

  it("exists / isDir / listDir / readText agree across forms", async () => {
    zipPath = await makeZip();
    const dir = await openContainer(SMOKE);
    const zip = await openContainer(zipPath);

    for (const c of [dir, zip]) {
      expect(await c.exists("run.yaml")).toBe(true);
      expect(await c.exists("tests")).toBe(true);
      expect(await c.exists("nope.txt")).toBe(false);

      expect(await c.isDir("tests")).toBe(true);
      expect(await c.isDir("tests/checkout")).toBe(true);
      expect(await c.isDir("run.yaml")).toBe(false);

      const top = await c.listDir("tests");
      expect(top.map((e) => e.name)).toEqual(["checkout", "login"]);
      expect(top.every((e) => e.isDir)).toBe(true);

      const checkout = (await c.listDir("tests/checkout")).map((e) => e.name);
      expect(checkout).toContain("result.yaml");
      expect(checkout).toContain("test.md");

      expect(await c.readText("run.yaml")).toContain("evidence:");
      expect(await c.readText("nope.txt")).toBeNull();
    }

    expect(await dir.listDir("tests/checkout")).toEqual(
      await zip.listDir("tests/checkout"),
    );
  });

  afterAll(async () => {
    if (zipPath) await fs.rm(path.dirname(zipPath), { recursive: true, force: true });
  });
});

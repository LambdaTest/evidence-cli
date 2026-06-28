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

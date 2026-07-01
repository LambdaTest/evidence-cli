import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { openContainer } from "./container";
import { FileByteSource, type ByteSource } from "./byte-source";
import { openRemoteZip } from "./remote";

const SMOKE = path.resolve(__dirname, "../../fixtures/0.1/L0/valid/smoke.evidence");

/** A ByteSource wrapper that records every ranged read, to prove selectivity. */
class CountingSource implements ByteSource {
  reads: Array<{ offset: number; length: number }> = [];
  bytesRead = 0;
  constructor(readonly inner: FileByteSource) {}
  size(): Promise<number> {
    return this.inner.size();
  }
  async read(offset: number, length: number): Promise<Buffer> {
    const b = await this.inner.read(offset, length);
    this.reads.push({ offset, length });
    this.bytesRead += b.length;
    return b;
  }
}

/**
 * Build a flat zip of `dir` (entries = directory contents, decision 0028),
 * optionally adding a large STORE'd "video" entry so we can prove a manifest
 * read does not pull the big artifact. Mirrors what finalize emits.
 */
async function makeZip(opts: { bigStore?: boolean } = {}): Promise<{
  zipPath: string;
  bigBytes?: Buffer;
}> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evi-remote-"));
  const zipPath = path.join(tmp, "smoke.evidence");
  const zip = new AdmZip();
  zip.addLocalFolder(SMOKE);
  let bigBytes: Buffer | undefined;
  if (opts.bigStore) {
    // Incompressible random bytes, STORE'd (decision 0041) — a stand-in for an
    // opaque media artifact that must NOT be fetched when reading the manifest.
    bigBytes = Buffer.alloc(512 * 1024);
    for (let i = 0; i < bigBytes.length; i++) bigBytes[i] = (i * 2654435761) & 0xff;
    const entry = "tests/checkout/video.mp4";
    zip.addFile(entry, bigBytes);
    // Force STORE (no deflate) on that entry.
    const e = zip.getEntry(entry);
    if (e) e.header.method = 0;
  }
  zip.writeZip(zipPath);
  return { zipPath, bigBytes };
}

describe("RemoteZipContainer parity (remote == dir == local zip)", () => {
  const cleanups: string[] = [];
  const sources: FileByteSource[] = [];
  afterAll(async () => {
    for (const s of sources) await s.close();
    for (const d of cleanups) await fs.rm(d, { recursive: true, force: true });
  });
  const source = (p: string): FileByteSource => {
    const s = new FileByteSource(p);
    sources.push(s);
    return s;
  };

  it("matches the directory and local-zip containers on the smoke pack", async () => {
    const { zipPath } = await makeZip();
    cleanups.push(path.dirname(zipPath));

    const dir = await openContainer(SMOKE);
    const local = await openContainer(zipPath);
    const remote = await openRemoteZip(source(zipPath), "smoke.evidence");

    expect(remote.kind).toBe("zip");
    expect(remote.name).toBe("smoke");

    expect(await remote.listTestIds()).toEqual(["checkout", "login"]);
    expect(await remote.listTestIds()).toEqual(await dir.listTestIds());

    expect(await remote.readManifest()).toEqual(await dir.readManifest());
    expect(await remote.readResult("checkout")).toEqual(
      await dir.readResult("checkout"),
    );
    expect(await remote.readResult("login")).toEqual(await local.readResult("login"));

    // Bytes round-trip identically (definition file is DEFLATE'd in the zip).
    const dBytes = await dir.readBytes("checkout", "test.md");
    const rBytes = await remote.readBytes("checkout", "test.md");
    expect(rBytes && dBytes && rBytes.equals(dBytes)).toBe(true);

    expect(await remote.fileExists("checkout", "test.md")).toBe(true);
    expect(await remote.fileExists("checkout", "nope.md")).toBe(false);
  });

  it("agrees on exists / isDir / listDir / readText with the dir container", async () => {
    const { zipPath } = await makeZip();
    cleanups.push(path.dirname(zipPath));

    const dir = await openContainer(SMOKE);
    const remote = await openRemoteZip(source(zipPath), "smoke.evidence");

    for (const rel of ["run.yaml", "tests", "tests/checkout", "tests/checkout/test.md", "nope"]) {
      expect(await remote.exists(rel)).toBe(await dir.exists(rel));
      expect(await remote.isDir(rel)).toBe(await dir.isDir(rel));
    }

    expect((await remote.listDir("tests")).map((e) => e.name)).toEqual([
      "checkout",
      "login",
    ]);
    expect(await remote.listDir("tests/checkout")).toEqual(
      await dir.listDir("tests/checkout"),
    );

    expect(await remote.readText("run.yaml")).toContain("evidence:");
    expect(await remote.readText("nope.txt")).toBeNull();
  });
});

describe("RemoteZipContainer selectivity (decision 0041)", () => {
  const cleanups: string[] = [];
  const sources: FileByteSource[] = [];
  afterAll(async () => {
    for (const s of sources) await s.close();
    for (const d of cleanups) await fs.rm(d, { recursive: true, force: true });
  });

  it("reads run.yaml without fetching the large STORE'd artifact", async () => {
    const { zipPath, bigBytes } = await makeZip({ bigStore: true });
    cleanups.push(path.dirname(zipPath));

    const counter = new CountingSource(new FileByteSource(zipPath));
    sources.push(counter.inner);
    const remote = await openRemoteZip(counter, "smoke.evidence");

    const bytesAfterOpen = counter.bytesRead;
    const manifest = await remote.readManifest();
    expect(manifest).toContain("evidence:");

    // The whole point: reading the manifest touches a tiny fraction of the pack,
    // never the 512 KiB video. Total bytes read stays far below the big artifact.
    expect(counter.bytesRead).toBeLessThan(bigBytes!.length);
    // And nowhere near the full archive size.
    const full = await counter.size();
    expect(counter.bytesRead).toBeLessThan(full / 2);
    // Sanity: we did read *something* for the manifest beyond opening.
    expect(counter.bytesRead).toBeGreaterThan(bytesAfterOpen - 1);
  });

  it("round-trips a large STORE'd entry byte-for-byte when asked", async () => {
    const { zipPath, bigBytes } = await makeZip({ bigStore: true });
    cleanups.push(path.dirname(zipPath));

    const src = new FileByteSource(zipPath);
    sources.push(src);
    const remote = await openRemoteZip(src, "smoke.evidence");
    const got = await remote.readBytes("checkout", "video.mp4");
    expect(got && got.equals(bigBytes!)).toBe(true);
  });
});

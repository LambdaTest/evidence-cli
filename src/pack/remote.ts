import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import type { ByteSource } from "./byte-source";
import type { DirEntry, PackContainer } from "./container";

const inflateRawAsync = promisify(inflateRaw);

// ZIP record signatures (little-endian uint32).
const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_EOCD64 = 0x06064b50; // ZIP64 end of central directory record
const SIG_EOCD64_LOC = 0x07064b50; // ZIP64 EOCD locator
const SIG_CD = 0x02014b50; // central directory file header
const SIG_LFH = 0x04034b50; // local file header

const EOCD_MIN = 22; // EOCD without comment
const MAX_COMMENT = 0xffff;
const ZIP64_SENTINEL32 = 0xffffffff;
const ZIP64_SENTINEL16 = 0xffff;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** A single central-directory entry — everything needed to range-read its data. */
interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Read an 8-byte LE value as a Number (offsets/sizes < 2^53; never realistic to exceed). */
function readU64(buf: Buffer, off: number): number {
  return Number(buf.readBigUInt64LE(off));
}

function stripEvidence(base: string): string {
  return base.replace(/\.evidence$/, "");
}

/**
 * Locate and parse the (optionally ZIP64) End-Of-Central-Directory, returning
 * the central directory's byte offset, size, and entry count. Reads only the
 * tail of the source — never the whole archive.
 */
async function readEocd(
  src: ByteSource,
): Promise<{ cdOffset: number; cdSize: number; count: number }> {
  const total = await src.size();
  const tailLen = Math.min(total, EOCD_MIN + MAX_COMMENT);
  const tail = await src.read(total - tailLen, tailLen);

  // Scan backwards for the EOCD signature, honouring the comment length so a
  // stray signature inside a comment can't fool us.
  let p = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== SIG_EOCD) continue;
    const commentLen = tail.readUInt16LE(i + 20);
    if (i + EOCD_MIN + commentLen === tail.length) {
      p = i;
      break;
    }
  }
  if (p === -1) throw new Error("not a zip: end-of-central-directory not found");

  let count = tail.readUInt16LE(p + 10);
  let cdSize = tail.readUInt32LE(p + 12);
  let cdOffset = tail.readUInt32LE(p + 16);

  const needsZip64 =
    count === ZIP64_SENTINEL16 ||
    cdSize === ZIP64_SENTINEL32 ||
    cdOffset === ZIP64_SENTINEL32;

  if (needsZip64) {
    // The ZIP64 EOCD locator sits immediately before the EOCD (20 bytes).
    const locPos = p - 20;
    const eocdStart = total - tailLen;
    if (locPos >= 0 && tail.readUInt32LE(locPos) === SIG_EOCD64_LOC) {
      const z64Offset = readU64(tail, locPos + 8);
      // The ZIP64 EOCD record may live before our tail window — read it directly.
      const inTail = z64Offset - eocdStart;
      const z64 =
        inTail >= 0 && inTail + 56 <= tail.length
          ? tail.subarray(inTail, inTail + 56)
          : await src.read(z64Offset, 56);
      if (z64.readUInt32LE(0) === SIG_EOCD64) {
        count = readU64(z64, 32);
        cdSize = readU64(z64, 40);
        cdOffset = readU64(z64, 48);
      }
    }
  }

  return { cdOffset, cdSize, count };
}

/** Apply ZIP64 overrides from a central-header extra field to the sentinel values. */
function applyZip64Extra(
  extra: Buffer,
  e: { uncompressedSize: number; compressedSize: number; localHeaderOffset: number },
): void {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i);
    const size = extra.readUInt16LE(i + 2);
    const body = i + 4;
    if (id === 0x0001) {
      // Fields appear in fixed order, only for those that overflowed to sentinel.
      let o = body;
      if (e.uncompressedSize === ZIP64_SENTINEL32 && o + 8 <= body + size) {
        e.uncompressedSize = readU64(extra, o);
        o += 8;
      }
      if (e.compressedSize === ZIP64_SENTINEL32 && o + 8 <= body + size) {
        e.compressedSize = readU64(extra, o);
        o += 8;
      }
      if (e.localHeaderOffset === ZIP64_SENTINEL32 && o + 8 <= body + size) {
        e.localHeaderOffset = readU64(extra, o);
        o += 8;
      }
      return;
    }
    i = body + size;
  }
}

/** Parse the central directory bytes into an ordered list of entries. */
function parseCentralDirectory(cd: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let i = 0;
  while (i + 46 <= cd.length && cd.readUInt32LE(i) === SIG_CD) {
    const method = cd.readUInt16LE(i + 10);
    const compressedSize = cd.readUInt32LE(i + 20);
    const uncompressedSize = cd.readUInt32LE(i + 24);
    const nameLen = cd.readUInt16LE(i + 28);
    const extraLen = cd.readUInt16LE(i + 30);
    const commentLen = cd.readUInt16LE(i + 32);
    const localHeaderOffset = cd.readUInt32LE(i + 42);

    const name = cd.toString("utf8", i + 46, i + 46 + nameLen);
    const extra = cd.subarray(i + 46 + nameLen, i + 46 + nameLen + extraLen);

    const entry: ZipEntry = {
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    };
    if (
      compressedSize === ZIP64_SENTINEL32 ||
      uncompressedSize === ZIP64_SENTINEL32 ||
      localHeaderOffset === ZIP64_SENTINEL32
    ) {
      applyZip64Extra(extra, entry);
    }

    entries.push(entry);
    i += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * A PackContainer that reads a sealed `.evidence` zip through a ranged
 * ByteSource — the central directory once, then only the entry byte-ranges it
 * needs. Implements decision 0041 over the existing container interface (0040):
 * the validator and viewer are unchanged; only *how* a pack is read differs.
 *
 * Construct via `openRemoteZip` (it parses the central directory up front).
 */
export class RemoteZipContainer implements PackContainer {
  readonly kind = "zip" as const;
  private readonly byName: Map<string, ZipEntry>;
  /** All entry names (including any explicit directory entries) for prefix ops. */
  private readonly names: string[];

  constructor(
    private readonly src: ByteSource,
    private readonly packName: string,
    entries: ZipEntry[],
  ) {
    this.byName = new Map();
    this.names = [];
    for (const e of entries) {
      this.names.push(e.name);
      if (!e.name.endsWith("/")) this.byName.set(e.name, e);
    }
  }

  get name(): string {
    return stripEvidence(this.packName);
  }

  /** Range-read and decompress a single entry's bytes, or null if absent. */
  private async readEntryBytes(entryName: string): Promise<Buffer | null> {
    const e = this.byName.get(entryName);
    if (!e) return null;

    // The local header's name/extra lengths can differ from the central
    // directory's, so the data offset must be read from the local header.
    const lfh = await this.src.read(e.localHeaderOffset, 30);
    if (lfh.length < 30 || lfh.readUInt32LE(0) !== SIG_LFH) {
      throw new Error(`corrupt local header for ${entryName}`);
    }
    const nameLen = lfh.readUInt16LE(26);
    const extraLen = lfh.readUInt16LE(28);
    const dataOffset = e.localHeaderOffset + 30 + nameLen + extraLen;

    const raw = await this.src.read(dataOffset, e.compressedSize);
    if (e.method === METHOD_STORE) return raw;
    if (e.method === METHOD_DEFLATE) return Buffer.from(await inflateRawAsync(raw));
    throw new Error(`unsupported compression method ${e.method} for ${entryName}`);
  }

  private async readEntryText(entryName: string): Promise<string | null> {
    const b = await this.readEntryBytes(entryName);
    return b ? b.toString("utf8") : null;
  }

  /** True if any entry sits under `<rel>/` — i.e. rel names a directory. */
  private hasPrefix(rel: string): boolean {
    const prefix = rel.endsWith("/") ? rel : `${rel}/`;
    return this.names.some((n) => n.startsWith(prefix));
  }

  async readManifest(): Promise<string | null> {
    return this.readEntryText("run.yaml");
  }

  async listTestIds(): Promise<string[]> {
    const ids = new Set<string>();
    for (const n of this.names) {
      const m = n.match(/^tests\/([^/]+)\//);
      if (m) ids.add(m[1]);
    }
    return [...ids].sort();
  }

  async readResult(testId: string): Promise<string | null> {
    return this.readEntryText(`tests/${testId}/result.yaml`);
  }

  async fileExists(testId: string, relPath: string): Promise<boolean> {
    return this.byName.has(`tests/${testId}/${relPath}`);
  }

  async readBytes(testId: string, relPath: string): Promise<Buffer | null> {
    return this.readEntryBytes(`tests/${testId}/${relPath}`);
  }

  async exists(rel: string): Promise<boolean> {
    return this.byName.has(rel) || this.hasPrefix(rel);
  }

  async isDir(rel: string): Promise<boolean> {
    return this.hasPrefix(rel);
  }

  async listDir(rel: string): Promise<DirEntry[]> {
    const prefix = rel === "" ? "" : rel.endsWith("/") ? rel : `${rel}/`;
    const children = new Map<string, boolean>(); // name -> isDir
    for (const n of this.names) {
      if (!n.startsWith(prefix)) continue;
      const rest = n.slice(prefix.length);
      if (rest === "") continue;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        if (!children.has(rest)) children.set(rest, false);
      } else {
        children.set(rest.slice(0, slash), true);
      }
    }
    return [...children.entries()]
      .map(([name, isDir]) => ({ name, isDir }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async readText(rel: string): Promise<string | null> {
    return this.readEntryText(rel);
  }
}

/**
 * Open a sealed pack over a ranged ByteSource. Reads and caches the central
 * directory (tail + CD only), so subsequent reads fetch just the entries asked
 * for. `packName` is the pack's file base name (e.g. "smoke.evidence").
 */
export async function openRemoteZip(
  src: ByteSource,
  packName: string,
): Promise<RemoteZipContainer> {
  const { cdOffset, cdSize } = await readEocd(src);
  const cd = await src.read(cdOffset, cdSize);
  const entries = parseCentralDirectory(cd);
  return new RemoteZipContainer(src, packName, entries);
}

import { promises as fs } from "node:fs";

/**
 * A random-access, ranged byte source — the seam that lets a pack be read
 * without downloading it whole (decision 0041). A local file, an HTTP server
 * speaking Range, or a blob-store object all implement this identically; the
 * RemoteZipContainer reads a zip's central directory and then only the entry
 * byte-ranges it needs through this interface.
 */
export interface ByteSource {
  /** Total length of the source in bytes. */
  size(): Promise<number>;
  /**
   * Read `length` bytes starting at `offset`. Returns the bytes actually
   * available (may be shorter than `length` only at EOF). `offset` is clamped
   * to >= 0; a read fully past EOF yields an empty buffer.
   */
  read(offset: number, length: number): Promise<Buffer>;
}

/**
 * A ByteSource backed by a local file, opened lazily and read with positional
 * reads (never loading the whole file). Useful as the default source and as a
 * stand-in for a blob object in tests.
 */
export class FileByteSource implements ByteSource {
  private handle: fs.FileHandle | null = null;
  private cachedSize: number | null = null;

  constructor(private readonly path: string) {}

  private async open(): Promise<fs.FileHandle> {
    if (!this.handle) this.handle = await fs.open(this.path, "r");
    return this.handle;
  }

  async size(): Promise<number> {
    if (this.cachedSize === null) {
      this.cachedSize = (await fs.stat(this.path)).size;
    }
    return this.cachedSize;
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0);
    const total = await this.size();
    const start = Math.max(0, Math.min(offset, total));
    const want = Math.max(0, Math.min(length, total - start));
    if (want === 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(want);
    const fh = await this.open();
    const { bytesRead } = await fh.read(buf, 0, want, start);
    return bytesRead === want ? buf : buf.subarray(0, bytesRead);
  }

  /** Release the underlying file handle (no-op if never opened). */
  async close(): Promise<void> {
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
  }
}

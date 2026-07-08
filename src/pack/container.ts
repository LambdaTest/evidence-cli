import { promises as fs } from "node:fs";
import * as path from "node:path";
import AdmZip from "adm-zip";

/** An immediate child of a pack directory, from listDir. */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface PackContainer {
  kind: "directory" | "zip";
  /** pack name = file/dir base name with the .evidence suffix stripped */
  name: string;
  readManifest(): Promise<string | null>;
  listTestIds(): Promise<string[]>;
  readResult(testId: string): Promise<string | null>;
  fileExists(testId: string, relPath: string): Promise<boolean>;
  readBytes(testId: string, relPath: string): Promise<Buffer | null>;

  // Pack-root-relative primitives (L1, decision 0040) — identical for dir & zip.
  /** Does an entry (file or directory) exist at this pack-root-relative path? */
  exists(rel: string): Promise<boolean>;
  /** Is the pack-root-relative path a directory? */
  isDir(rel: string): Promise<boolean>;
  /** Immediate children of a pack-root-relative directory (sorted by name). */
  listDir(rel: string): Promise<DirEntry[]>;
  /** Read a pack-root-relative text file, or null if absent. */
  readText(rel: string): Promise<string | null>;
  /** Read a pack-root-relative file's bytes, or null if absent (decision 0045: tree copy for merge). */
  readFileBytes(rel: string): Promise<Buffer | null>;
}

function stripEvidence(base: string): string {
  return base.replace(/\.evidence$/, "");
}

export class DirectoryContainer implements PackContainer {
  readonly kind = "directory" as const;
  constructor(private readonly root: string) {}

  get name(): string {
    return stripEvidence(path.basename(this.root));
  }

  async readManifest(): Promise<string | null> {
    return readFileOrNull(path.join(this.root, "run.yaml"));
  }

  async listTestIds(): Promise<string[]> {
    try {
      const entries = await fs.readdir(path.join(this.root, "tests"), {
        withFileTypes: true,
      });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }

  async readResult(testId: string): Promise<string | null> {
    return readFileOrNull(path.join(this.root, "tests", testId, "result.yaml"));
  }

  async fileExists(testId: string, relPath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.root, "tests", testId, relPath));
      return true;
    } catch {
      return false;
    }
  }

  async readBytes(testId: string, relPath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path.join(this.root, "tests", testId, relPath));
    } catch {
      return null;
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.root, rel));
      return true;
    } catch {
      return false;
    }
  }

  async isDir(rel: string): Promise<boolean> {
    try {
      return (await fs.stat(path.join(this.root, rel))).isDirectory();
    } catch {
      return false;
    }
  }

  async listDir(rel: string): Promise<DirEntry[]> {
    try {
      const entries = await fs.readdir(path.join(this.root, rel), {
        withFileTypes: true,
      });
      return entries
        .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async readText(rel: string): Promise<string | null> {
    return readFileOrNull(path.join(this.root, rel));
  }

  async readFileBytes(rel: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path.join(this.root, rel));
    } catch {
      return null;
    }
  }
}

export class ZipContainer implements PackContainer {
  readonly kind = "zip" as const;
  private readonly zip: AdmZip;
  constructor(private readonly file: string) {
    this.zip = new AdmZip(file);
  }

  get name(): string {
    return stripEvidence(path.basename(this.file));
  }

  private readEntry(entry: string): string | null {
    const e = this.zip.getEntry(entry);
    return e ? e.getData().toString("utf8") : null;
  }

  async readManifest(): Promise<string | null> {
    return this.readEntry("run.yaml");
  }

  async listTestIds(): Promise<string[]> {
    const ids = new Set<string>();
    for (const e of this.zip.getEntries()) {
      const m = e.entryName.match(/^tests\/([^/]+)\//);
      if (m) ids.add(m[1]);
    }
    return [...ids].sort();
  }

  async readResult(testId: string): Promise<string | null> {
    return this.readEntry(`tests/${testId}/result.yaml`);
  }

  async fileExists(testId: string, relPath: string): Promise<boolean> {
    return this.zip.getEntry(`tests/${testId}/${relPath}`) != null;
  }

  async readBytes(testId: string, relPath: string): Promise<Buffer | null> {
    const e = this.zip.getEntry(`tests/${testId}/${relPath}`);
    return e ? e.getData() : null;
  }

  /** True if any entry sits under `<rel>/` — i.e. rel is a directory. */
  private hasPrefix(rel: string): boolean {
    const prefix = rel.endsWith("/") ? rel : `${rel}/`;
    return this.zip.getEntries().some((e) => e.entryName.startsWith(prefix));
  }

  async exists(rel: string): Promise<boolean> {
    return this.zip.getEntry(rel) != null || this.hasPrefix(rel);
  }

  async isDir(rel: string): Promise<boolean> {
    return this.hasPrefix(rel);
  }

  async listDir(rel: string): Promise<DirEntry[]> {
    const prefix = rel === "" ? "" : rel.endsWith("/") ? rel : `${rel}/`;
    const children = new Map<string, boolean>(); // name -> isDir
    for (const e of this.zip.getEntries()) {
      if (!e.entryName.startsWith(prefix)) continue;
      const rest = e.entryName.slice(prefix.length);
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
    const e = this.zip.getEntry(rel);
    return e ? e.getData().toString("utf8") : null;
  }

  async readFileBytes(rel: string): Promise<Buffer | null> {
    const e = this.zip.getEntry(rel);
    return e ? e.getData() : null;
  }
}

export async function openContainer(target: string): Promise<PackContainer> {
  const stat = await fs.stat(target);
  return stat.isDirectory()
    ? new DirectoryContainer(target)
    : new ZipContainer(target);
}

async function readFileOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

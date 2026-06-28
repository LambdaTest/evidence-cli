import { promises as fs } from "node:fs";
import * as path from "node:path";
import AdmZip from "adm-zip";

export interface PackContainer {
  kind: "directory" | "zip";
  /** pack name = file/dir base name with the .evidence suffix stripped */
  name: string;
  readManifest(): Promise<string | null>;
  listTestIds(): Promise<string[]>;
  readResult(testId: string): Promise<string | null>;
  fileExists(testId: string, relPath: string): Promise<boolean>;
  readBytes(testId: string, relPath: string): Promise<Buffer | null>;
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

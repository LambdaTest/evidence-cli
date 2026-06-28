import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_PROFILE } from "./contract";

export interface EvidenceConfig {
  defaultProfile?: string;
}

export function configPath(flag?: string): string {
  if (flag) return flag;
  if (process.env.EVIDENCE_CONFIG) return process.env.EVIDENCE_CONFIG;
  return path.join(os.homedir(), ".testmuai", "evidence", "config.json");
}

export async function loadConfig(flag?: string): Promise<EvidenceConfig> {
  const p = configPath(flag);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch {
    return {}; // a missing config is fine — built-in default applies
  }
  try {
    return JSON.parse(raw) as EvidenceConfig;
  } catch {
    const e = new Error(`config at ${p} is not valid JSON`) as Error & { code?: string };
    e.code = "USAGE";
    throw e;
  }
}

export function resolveProfile(flag: string | undefined, config: EvidenceConfig): string {
  return flag ?? config.defaultProfile ?? DEFAULT_PROFILE;
}

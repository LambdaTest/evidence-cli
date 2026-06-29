import runL0 from "./0.1/L0/run.schema.json";
import resultL0 from "./0.1/L0/result.schema.json";
import logsMetaL1 from "./0.1/L1/logs-meta.schema.json";
import videoL1 from "./0.1/L1/video.schema.json";

export interface SchemaPair {
  run: object;
  result: object;
}

/** The L1 declaration schemas evidence-cli parses (artifacts stay opaque). */
export interface L1Schemas {
  logsMeta: object;
  video: object;
}

// Version-first (decision 0038): one contract version contains its profile
// ladder. A future breaking 0.2 is a sibling subtree, leaving 0.1 untouched.
const REGISTRY: Record<string, Record<string, SchemaPair>> = {
  "0.1": {
    L0: { run: runL0 as object, result: resultL0 as object },
  },
};

const L1_REGISTRY: Record<string, L1Schemas> = {
  "0.1": { logsMeta: logsMetaL1 as object, video: videoL1 as object },
};

export function getSchemas(version: string, profile: string): SchemaPair {
  const byProfile = REGISTRY[version];
  if (!byProfile) {
    throw new Error(`no schemas for contract version ${version}`);
  }
  const pair = byProfile[profile];
  if (!pair) {
    throw new Error(`no schemas for profile ${profile} at version ${version}`);
  }
  return pair;
}

export function getL1Schemas(version: string): L1Schemas {
  const s = L1_REGISTRY[version];
  if (!s) {
    throw new Error(`no L1 schemas for contract version ${version}`);
  }
  return s;
}

import runL0 from "./0.1/L0/run.schema.json";
import resultL0 from "./0.1/L0/result.schema.json";

export interface SchemaPair {
  run: object;
  result: object;
}

// Version-first (decision 0038): one contract version contains its profile
// ladder. A future breaking 0.2 is a sibling subtree, leaving 0.1 untouched.
const REGISTRY: Record<string, Record<string, SchemaPair>> = {
  "0.1": {
    L0: { run: runL0 as object, result: resultL0 as object },
  },
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

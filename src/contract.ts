export const CONTRACT_VERSION = "0.1" as const;
export const DEFAULT_PROFILE = "L0" as const;

export type Verdict = "passed" | "failed" | "broken" | "skipped";
export type RunStatus = "running" | "finalized" | "aborted";
export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  location: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  profile: string;
  version: string;
  diagnostics: Diagnostic[];
}

export interface Totals {
  tests: number;
  passed: number;
  failed: number;
  broken: number;
  skipped: number;
}

export interface FinalizeResult {
  totals: Totals;
  sealedPath: string;
}

export const Codes = {
  MANIFEST_MISSING: "manifest.missing",
  MANIFEST_PARSE: "manifest.parse",
  RESULT_MISSING: "result.missing",
  RESULT_PARSE: "result.parse",
  VERSION_UNSUPPORTED: "version.unsupported",
  SCHEMA: "schema.invalid",
  TEST_ID_MISMATCH: "test.id_mismatch",
  DEFINITION_MISSING: "definition.missing",
  DEFINITION_PATH_ESCAPE: "definition.path_escape",
  ORDINAL_COLLISION: "ordinal.collision",
  ORDINAL_NOT_INCREASING: "ordinal.not_increasing",
  ENDED_BEFORE_STARTED: "ended.before_started",
  TOTALS_MISMATCH: "totals.mismatch",
  HASH_MISSING: "definition.hash_missing",
  HASH_MISMATCH: "definition.hash_mismatch",
  STATUS_DISAGREES: "status.disagrees_with_steps",
} as const;

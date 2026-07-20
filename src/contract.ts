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
  /** run.yaml.status (running | finalized | aborted), or null if unreadable. */
  status: string | null;
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

/** The outcome of `evidence merge` (decision 0045). Policy-sanctioned skips
 * and discards land here, not in the pack — merged_from is the only in-pack
 * trace of the merge. */
export interface MergeReport {
  packs: {
    eligible: string[]; // run_ids, CLI order
    skipped: { runId: string; rule: string; reason: string }[];
  };
  tests: {
    merged: number;
    // `action`/`folder` are present only for 0046's shape-changing outcomes;
    // the three original fields are unconditional, so existing --json
    // consumers keep parsing unchanged.
    collisions: { test: string; winner: string; rule: string; action?: "nest" | "split"; folder?: string }[];
    discarded: string[];
  };
  output: { path: string; runId: string; finalized: boolean };
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

  // L1 (decision 0040). Presence codes (*_MISSING for logs/steps/coverage) fire
  // only when status: finalized; shape codes fire at any status.
  L1_LOGS_MISSING: "l1.logs.missing",
  L1_LOGS_META_MISSING: "l1.logs.meta_missing",
  L1_LOGS_META_INVALID: "l1.logs.meta_invalid",
  L1_LOG_FILE_MISSING: "l1.logs.file_missing",
  L1_LOG_PATH_ESCAPE: "l1.logs.path_escape",
  L1_STEPS_MISSING: "l1.steps.missing",
  L1_STEPS_MALFORMED: "l1.steps.malformed_name",
  L1_STEPS_UNMATCHED: "l1.steps.unmatched",
  L1_STEPS_SCREENSHOT_MISSING: "l1.steps.screenshot_missing",
  L1_COVERAGE_MISSING: "l1.coverage.missing",
  L1_VIDEO_INVALID: "l1.video.invalid",

  // L1 failure records (decision 0044). Step-level records are shape-checked at
  // any status; l1.failure.missing (advisory) and l1.failure_index.missing fire
  // only when status: finalized.
  L1_FAILURE_INVALID: "l1.failure.invalid",
  L1_FAILURE_UNMATCHED: "l1.failure.unmatched",
  L1_FAILURE_REF_ESCAPE: "l1.failure.ref_escape",
  L1_FAILURE_REF_MISSING: "l1.failure.ref_missing",
  L1_FAILURE_STATUS_DISAGREES: "l1.failure.status_disagrees",
  L1_FAILURE_MISSING: "l1.failure.missing",
  L1_FAILURE_INDEX_MISSING: "l1.failure_index.missing",
  L1_FAILURE_INDEX_INVALID: "l1.failure_index.invalid",
  L1_FAILURE_INDEX_DANGLING: "l1.failure_index.dangling",
  L1_FAILURE_INDEX_INCOMPLETE: "l1.failure_index.incomplete",
} as const;

/**
 * A profile resolves to an ordered chain of layers — additive (decision 0027/0040):
 * L1 keeps every L0 check and adds its own. `validate --profile L1` runs the chain
 * in order.
 */
export const PROFILES: Record<string, string[]> = {
  L0: ["L0"],
  L1: ["L0", "L1"],
};

export function profileChain(profile: string): string[] | null {
  return PROFILES[profile] ?? null;
}

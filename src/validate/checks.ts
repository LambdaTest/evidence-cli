import type { Diagnostic } from "../contract";
import type { PackContainer } from "../pack/container";

export interface CrossCheckInput {
  run: unknown;
  tests: { testId: string; result: unknown }[];
  container: PackContainer;
}

// Stub — real cross-checks land in Task 8.
export async function runCrossChecks(_input: CrossCheckInput): Promise<Diagnostic[]> {
  return [];
}

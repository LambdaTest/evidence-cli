import { describe, expect, it } from "vitest";
import { loadL1Schemas } from "./compile";

// The step-level failure.yaml schema (decision 0044): required core + the
// strictly-shaped triage block. Reference containment/existence is a validator
// cross-check, not schema — so it is not tested here.
const { failure, failureIndex } = loadL1Schemas("0.1");

const core = { step: "pay", status: "broken", error: { message: "timeout" } };

describe("failure.schema.json — required core", () => {
  it("accepts step + status + error.message", () => {
    expect(failure(core)).toBe(true);
  });

  it("accepts step + status + expected/actual (no error)", () => {
    expect(failure({ step: "pay", status: "failed", expected: "a", actual: "b" })).toBe(true);
  });

  it("rejects a record that names no cause (no error.message, no expected+actual)", () => {
    expect(failure({ step: "pay", status: "failed" })).toBe(false);
    expect(failure({ step: "pay", status: "failed", expected: "a" })).toBe(false);
    expect(failure({ step: "pay", status: "failed", error: { type: "X" } })).toBe(false);
  });

  it("rejects a missing step / status and a non-verdict status", () => {
    expect(failure({ status: "failed", error: { message: "x" } })).toBe(false);
    expect(failure({ step: "pay", error: { message: "x" } })).toBe(false);
    expect(failure({ ...core, status: "exploded" })).toBe(false);
  });

  it("accepts an optional title; rejects an empty one", () => {
    expect(failure({ ...core, title: "Checkout page renders blank" })).toBe(true);
    expect(failure({ ...core, title: "" })).toBe(false);
  });

  it("keeps forensic blocks open (locator_context, trajectory_refs, extra keys)", () => {
    expect(
      failure({
        ...core,
        locator_context: { strategy: "css", anything: [1, 2] },
        trajectory_refs: ["t:5370"],
        custom_block: { deep: true },
      }),
    ).toBe(true);
  });
});

describe("failure.schema.json — strict triage when present", () => {
  it("requires triage.status from the closed lifecycle enum", () => {
    expect(failure({ ...core, triage: {} })).toBe(false);
    expect(failure({ ...core, triage: { status: "reviewing" } })).toBe(false);
    for (const s of ["untriaged", "triaged", "in_progress", "dismissed"]) {
      expect(failure({ ...core, triage: { status: s } })).toBe(true);
    }
  });

  it("requires rca.root_cause when rca is present", () => {
    expect(failure({ ...core, triage: { status: "triaged", rca: { category: "Infra" } } })).toBe(false);
    expect(failure({ ...core, triage: { status: "triaged", rca: { root_cause: "firewall" } } })).toBe(true);
  });

  it("bounds rca.confidence to [0, 1]", () => {
    const rca = (confidence: number) => ({ ...core, triage: { status: "triaged", rca: { root_cause: "x", confidence } } });
    expect(failure(rca(0.81))).toBe(true);
    expect(failure(rca(1.5))).toBe(false);
    expect(failure(rca(-0.1))).toBe(false);
  });

  it("requires by.at as a date-time when by is present", () => {
    const by = (at?: unknown) => ({ ...core, triage: { status: "triaged", by: at === undefined ? { kind: "agent" } : { kind: "agent", at } } });
    expect(failure(by())).toBe(false);
    expect(failure(by("last tuesday"))).toBe(false);
    expect(failure(by("2026-07-06T09:05:00Z"))).toBe(true);
  });

  it("requires verification.status from its closed enum", () => {
    const v = (status?: string) => ({ ...core, triage: { status: "triaged", verification: status === undefined ? {} : { status } } });
    expect(failure(v())).toBe(false);
    expect(failure(v("maybe"))).toBe(false);
    for (const s of ["not_verified", "verified", "refuted"]) expect(failure(v(s))).toBe(true);
  });
});

describe("failure-index.schema.json", () => {
  const row = {
    test: "checkout",
    ordinal: 2,
    step: "pay",
    status: "broken",
    path: "tests/checkout/steps/2-pay/failure.yaml",
  };

  it("accepts a well-formed index and an empty one", () => {
    expect(failureIndex({ generated: "2026-07-06T09:01:00Z", totals: { failures: 1 }, failures: [{ ...row, triage_status: "triaged" }] })).toBe(true);
    expect(failureIndex({ failures: [] })).toBe(true);
  });

  it("accepts an optional lifted title on a row; rejects an empty one", () => {
    expect(failureIndex({ failures: [{ ...row, title: "Checkout page renders blank" }] })).toBe(true);
    expect(failureIndex({ failures: [{ ...row, title: "" }] })).toBe(false);
  });

  it("rejects a row missing a required field or with a bad enum", () => {
    const { path: _p, ...noPath } = row;
    expect(failureIndex({ failures: [noPath] })).toBe(false);
    expect(failureIndex({ failures: [{ ...row, status: "exploded" }] })).toBe(false);
    expect(failureIndex({ failures: [{ ...row, ordinal: 0 }] })).toBe(false);
    expect(failureIndex({ failures: [{ ...row, triage_status: "reviewing" }] })).toBe(false);
  });

  it("rejects a document without failures", () => {
    expect(failureIndex({})).toBe(false);
  });
});

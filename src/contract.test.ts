import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, DEFAULT_PROFILE, Codes, PROFILES, profileChain } from "./contract";

describe("contract constants", () => {
  it("pins the contract version to 0.1", () => {
    expect(CONTRACT_VERSION).toBe("0.1");
  });
  it("defaults the profile to L0", () => {
    expect(DEFAULT_PROFILE).toBe("L0");
  });
  it("exposes stable diagnostic codes", () => {
    expect(Codes.VERSION_UNSUPPORTED).toBe("version.unsupported");
    expect(Codes.TOTALS_MISMATCH).toBe("totals.mismatch");
    expect(Codes.ORDINAL_COLLISION).toBe("ordinal.collision");
  });
  it("exposes L1 diagnostic codes", () => {
    expect(Codes.L1_LOGS_MISSING).toBe("l1.logs.missing");
    expect(Codes.L1_STEPS_UNMATCHED).toBe("l1.steps.unmatched");
    expect(Codes.L1_COVERAGE_MISSING).toBe("l1.coverage.missing");
  });
});

describe("profile chains (additive layering, decision 0040)", () => {
  it("L0 resolves to just [L0]", () => {
    expect(PROFILES.L0).toEqual(["L0"]);
    expect(profileChain("L0")).toEqual(["L0"]);
  });
  it("L1 resolves to [L0, L1] — L0 first, then the L1 additions", () => {
    expect(PROFILES.L1).toEqual(["L0", "L1"]);
    expect(profileChain("L1")).toEqual(["L0", "L1"]);
  });
  it("an unknown profile has no chain", () => {
    expect(profileChain("L9")).toBeNull();
  });
});

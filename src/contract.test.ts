import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, DEFAULT_PROFILE, Codes } from "./contract";

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
});

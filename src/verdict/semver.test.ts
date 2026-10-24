import { describe, expect, it } from "vitest";
import { compareSemver, parseSemver } from "./semver";

describe("parseSemver", () => {
  it.each([
    ["1.2.3", { core: [1, 2, 3], pre: [] }],
    ["v0.8.10", { core: [0, 8, 10], pre: [] }],
    ["0.9.1-qa.verdictpolicy.1", { core: [0, 9, 1], pre: ["qa", "verdictpolicy", "1"] }],
    ["1.0.0+build.5", { core: [1, 0, 0], pre: [] }],
    ["1.2", null],
    ["latest", null],
    [7, null],
  ])("%s", (text, want) => {
    expect(parseSemver(text)).toEqual(want);
  });
});

describe("compareSemver", () => {
  it.each([
    ["0.8.10", "0.8.9", 1],
    ["0.8.10", "0.8.10", 0],
    ["0.8.10-rc.1", "0.8.10", -1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", -1],
    ["1.0.0-beta.2", "1.0.0-beta.11", -1],
    ["1.0.0-rc.1", "1.0.0-beta.11", 1],
    ["0.10.0", "0.9.9", 1],
  ])("%s vs %s", (a, b, sign) => {
    expect(Math.sign(compareSemver(parseSemver(a)!, parseSemver(b)!))).toBe(sign);
  });
});

import { describe, expect, it } from "vitest";
import { parseYaml, parseDoc, stringifyDoc } from "./yaml";

describe("yaml utilities", () => {
  it("parses YAML to a plain object", () => {
    expect(parseYaml("a: 1\nb: two\n")).toEqual({ a: 1, b: "two" });
  });

  it("round-trips, preserving comments and only changing the edited field", () => {
    const src = "# top comment\nstatus: running\ntitle: keep me\n";
    const doc = parseDoc(src);
    doc.setIn(["status"], "finalized");
    const out = stringifyDoc(doc);
    expect(out).toContain("# top comment");
    expect(out).toContain("title: keep me");
    expect(out).toContain("status: finalized");
    expect(out).not.toContain("status: running");
  });
});

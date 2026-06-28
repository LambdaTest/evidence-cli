import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resolveProfile, configPath } from "./config";

describe("config", () => {
  it("resolves --flag over config over the L0 default", () => {
    expect(resolveProfile("L1", { defaultProfile: "L2" })).toBe("L1");
    expect(resolveProfile(undefined, { defaultProfile: "L2" })).toBe("L2");
    expect(resolveProfile(undefined, {})).toBe("L0");
  });

  it("treats a missing config file as empty", async () => {
    const missing = path.join(os.tmpdir(), "evi-nope-" + Date.now() + ".json");
    expect(await loadConfig(missing)).toEqual({});
  });

  it("reads defaultProfile from a JSON config", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evi-cfg-"));
    const p = path.join(dir, "config.json");
    await fs.writeFile(p, JSON.stringify({ defaultProfile: "L0" }));
    expect(await loadConfig(p)).toEqual({ defaultProfile: "L0" });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("throws a USAGE error on malformed JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evi-cfg-"));
    const p = path.join(dir, "config.json");
    await fs.writeFile(p, "{ not json");
    await expect(loadConfig(p)).rejects.toMatchObject({ code: "USAGE" });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("defaults the config path under ~/.testmuai/evidence", () => {
    expect(configPath()).toMatch(/[/\\]\.testmuai[/\\]evidence[/\\]config\.json$/);
  });
});

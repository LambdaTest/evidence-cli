import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assemble } from "./assemble";
import { resolveCollisions } from "./collide";
import { gatePacks } from "./gates";
import { DEFAULT_RULES } from "./rules";
import { stagePack, sealCopy } from "./testkit";
import { parseYaml } from "../yaml";
import { validate } from "../validate";

async function stagePair(): Promise<{ out: string; eligible: any[]; groups: any[] }> {
  const a = await sealCopy(
    await stagePack({
      runId: "a",
      started: "2026-07-08T08:00:00Z",
      ended: "2026-07-08T09:00:00Z",
      l1: true,
      environment: { producer: { name: "kane" }, ci: { shard: "1" } },
      metrics: { requests: { value: 3, type: "count" } },
      tests: { login: {} },
    }),
  );
  const b = await sealCopy(
    await stagePack({
      runId: "b",
      started: "2026-07-08T08:30:00Z",
      ended: "2026-07-08T09:30:00Z",
      l1: true,
      environment: { producer: { name: "kane" }, ci: { shard: "2" } },
      tests: { checkout: { environment: { ci: { shard: "own" } } } },
    }),
  );
  const { eligible } = await gatePacks([a, b], DEFAULT_RULES);
  const { groups } = await resolveCollisions(eligible, DEFAULT_RULES);
  const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evi-asm-")), "m.evidence");
  return { out, eligible, groups };
}

const IDENTITY_RULES: any = {
  ...DEFAULT_RULES,
  tests: {
    on_collision: "error",
    identity: { keys: ["external_id.commit_id"], on_same: "nest", on_different: "split" },
  },
};

/** Stage N packs that all claim `login`, resolve them under the identity policy. */
async function stageGrouped(specs: any[]): Promise<{ out: string; eligible: any[]; groups: any[] }> {
  const paths: string[] = [];
  for (const s of specs) paths.push(await sealCopy(await stagePack({ l1: true, ...s })));
  const { eligible } = await gatePacks(paths, IDENTITY_RULES);
  const { groups } = await resolveCollisions(eligible, IDENTITY_RULES);
  const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "evi-asm-")), "m.evidence");
  return { out, eligible, groups };
}

const readResult = async (out: string, rel: string): Promise<any> =>
  parseYaml(await fs.readFile(path.join(out, "tests", rel, "result.yaml"), "utf8"));

describe("assemble — identity grouping (0046)", () => {
  it("keeps the latest member canonical and nests superseded ones oldest-first", async () => {
    // CLI order deliberately differs from chronological order
    const { out, eligible, groups } = await stageGrouped([
      { runId: "b", ended: "2026-07-08T10:00:00Z", tests: { login: { externalId: { commit_id: "abc", session_id: "s-b" } } } },
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { login: { externalId: { commit_id: "abc", session_id: "s-a" } } } },
      { runId: "c", ended: "2026-07-08T11:00:00Z", tests: { login: { externalId: { commit_id: "abc", session_id: "s-c" } } } },
    ]);
    await assemble(out, { runId: "nightly" }, eligible, groups);

    expect((await readResult(out, "login")).external_id.session_id).toBe("s-c"); // latest
    expect((await readResult(out, "login/1")).external_id.session_id).toBe("s-a"); // oldest
    expect((await readResult(out, "login/2")).external_id.session_id).toBe("s-b");
    // nested copies carry their whole tree
    await fs.access(path.join(out, "tests/login/1/test.md"));
    await fs.access(path.join(out, "tests/login/1/logs/console.ndjson"));
    await fs.access(path.join(out, "tests/login/1/steps/2-pay/screenshot.png"));
  });

  it("rewrites test: in a split folder, leaves it untouched in a nested copy", async () => {
    const { out, eligible, groups } = await stageGrouped([
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { login: { externalId: { commit_id: "abc" } } } },
      { runId: "b", ended: "2026-07-08T10:00:00Z", tests: { login: { externalId: { commit_id: "abc" } } } },
      { runId: "c", ended: "2026-07-08T11:00:00Z", tests: { login: { externalId: { commit_id: "zzz" } } } },
    ]);
    await assemble(out, { runId: "nightly" }, eligible, groups);

    expect((await readResult(out, "login")).test).toBe("login");
    expect((await readResult(out, "login/1")).test).toBe("login"); // archive stays truthful
    expect((await readResult(out, "login-1")).test).toBe("login-1"); // must equal its directory
  });

  it("pushes divergent environment down into nested copies from their own source", async () => {
    const { out, eligible, groups } = await stageGrouped([
      {
        runId: "a",
        ended: "2026-07-08T09:00:00Z",
        environment: { producer: { name: "kane" }, ci: { shard: "1" } },
        tests: { login: { externalId: { commit_id: "abc" } } },
      },
      {
        runId: "b",
        ended: "2026-07-08T10:00:00Z",
        environment: { producer: { name: "kane" }, ci: { shard: "2" } },
        tests: { login: { externalId: { commit_id: "abc" } } },
      },
    ]);
    await assemble(out, { runId: "nightly" }, eligible, groups);

    expect((await readResult(out, "login")).environment.ci).toEqual({ shard: "2" }); // canonical = pack b
    expect((await readResult(out, "login/1")).environment.ci).toEqual({ shard: "1" }); // nested = pack a
  });

  it("a pack with nested and split folders validates clean at L0", async () => {
    const { out, eligible, groups } = await stageGrouped([
      { runId: "a", ended: "2026-07-08T09:00:00Z", tests: { login: { externalId: { commit_id: "abc" } } } },
      { runId: "b", ended: "2026-07-08T10:00:00Z", tests: { login: { externalId: { commit_id: "abc" } } } },
      { runId: "c", ended: "2026-07-08T11:00:00Z", tests: { login: { externalId: { commit_id: "zzz" } } } },
    ]);
    await assemble(out, { runId: "nightly" }, eligible, groups);
    const report = await validate(out, { profile: "L0" });
    expect(report.valid).toBe(true);
  });
});

describe("assemble", () => {
  it("synthesizes run.yaml, pushes divergent env down, namespaces coverage/metrics, copies whole trees", async () => {
    const { out, eligible, groups } = await stagePair();
    await assemble(out, { runId: "nightly" }, eligible, groups);

    const run = parseYaml(await fs.readFile(path.join(out, "run.yaml"), "utf8")) as any;
    expect(run).toMatchObject({ evidence: "0.1", run_id: "nightly", status: "running", title: "t-a" });
    expect(run.started).toBe("2026-07-08T08:00:00Z"); // min of sources
    expect(run.merged_from).toEqual(["a", "b"]);
    expect(run.ended).toBeUndefined();
    expect(run.totals).toBeUndefined();
    expect(run.metrics["1-a/requests"]).toEqual({ value: 3, type: "count" });
    expect(Object.keys(run.metrics)).toEqual(["1-a/requests"]); // b has none
    expect(run.environment).toEqual({ producer: { name: "kane" } }); // common subset only

    // push-down: divergent ci landed per-test from each source pack
    const login = parseYaml(await fs.readFile(path.join(out, "tests/login/result.yaml"), "utf8")) as any;
    expect(login.environment.ci).toEqual({ shard: "1" }); // from pack a
    // per-test value wins: checkout already carried its own ci
    const checkout = parseYaml(await fs.readFile(path.join(out, "tests/checkout/result.yaml"), "utf8")) as any;
    expect(checkout.environment.ci).toEqual({ shard: "own" });

    // whole-tree copy: definition + logs travel byte-identical
    expect(await fs.readFile(path.join(out, "tests/login/test.md"), "utf8")).toContain("A staged test definition");
    await fs.access(path.join(out, "tests/login/logs/console.ndjson"));
    // coverage nesting; no root failure.yaml on the live merged pack
    expect((await fs.stat(path.join(out, "coverage/1-a"))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(out, "coverage/2-b"))).isDirectory()).toBe(true);
    await expect(fs.access(path.join(out, "failure.yaml"))).rejects.toThrow();
  });

  it("the assembled pack validates clean at L0 while running", async () => {
    const { out, eligible, groups } = await stagePair();
    await assemble(out, { runId: "nightly" }, eligible, groups);
    const report = await validate(out, { profile: "L0" });
    expect(report.valid).toBe(true);
    expect(report.status).toBe("running");
  });

  it("refuses to overwrite an existing output path (USAGE)", async () => {
    const { out, eligible, groups } = await stagePair();
    await fs.mkdir(out, { recursive: true });
    await expect(assemble(out, { runId: "nightly" }, eligible, groups)).rejects.toMatchObject({ code: "USAGE" });
  });

  it("--title overrides the first pack's title", async () => {
    const { out, eligible, groups } = await stagePair();
    await assemble(out, { runId: "nightly", title: "Nightly regression" }, eligible, groups);
    const run = parseYaml(await fs.readFile(path.join(out, "run.yaml"), "utf8")) as any;
    expect(run.title).toBe("Nightly regression");
  });
});

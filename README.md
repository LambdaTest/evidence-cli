# evidence-cli — TestMu AI (formerly LambdaTest)

**An open, framework-agnostic format for what a test run produced — the
`.evidence` pack, and the library + CLI that validate, seal, merge and judge it.**

[![npm version](https://img.shields.io/npm/v/@testmuai/evidence-cli)](https://www.npmjs.com/package/@testmuai/evidence-cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/LambdaTest/evidence-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/LambdaTest/evidence-cli/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/SqVMtNeWEf)

One shape, whatever made it — a browser agent, a Playwright suite, a Jest run, an
API check. An evidence pack is readable by a CI dashboard, an auditor, or a human
without knowing the framework that wrote it.

## Install

```bash
# As a library (Node 20.19+)
npm install @testmuai/evidence-cli

# Or the CLI, globally
npm install -g @testmuai/evidence-cli
```

## Two ways to use it

### As a library

```ts
import { validate, finalize } from "@testmuai/evidence-cli";

// Validate a pack — a directory or a sealed .evidence zip — against a profile.
const report = await validate("my-run.evidence", { profile: "L1" });
if (!report.valid) {
  for (const d of report.diagnostics) {
    console.error(`${d.severity} ${d.location}: ${d.message} [${d.code}]`);
  }
}

// Seal a live directory into a flat, range-addressable .evidence zip (atomically).
const { totals, sealedPath } = await finalize("my-run.evidence", {
  endedAt: new Date().toISOString(),
});
```

Judge a sealed pack against one or more policies. The pack is never modified;
each verdict is a separate document you keep beside it:

```ts
import { verdict, writeVerdicts, lintPolicy } from "@testmuai/evidence-cli";
import { readFileSync } from "node:fs";

const content = readFileSync("release-policy.yaml", "utf8");
for (const d of lintPolicy(content)) console.error(`${d.code} line ${d.line}: ${d.message}`);

const [doc] = await verdict("my-run.evidence", { policies: [{ content, path: "release-policy.yaml" }] });
console.log(doc.result, doc.failed_gates); // "fail" [ "all-pass" ]
await writeVerdicts([doc], "."); // ./release-2.x.verdict.json
```

The package ships type definitions; `validate` and `finalize` are the load-bearing
entry points, and the pack container types (`openContainer`, `RemoteZipContainer`,
…) are exported for reading packs directly — including ranged reads from a blob
store.

### As a CLI

```bash
evidence validate my-run.evidence --profile L0   # check a directory OR a sealed .evidence zip
evidence validate my-run.evidence --profile L1   # L1 = L0 + the captured-artifact layer
evidence finalize my-run.evidence/               # roll up totals, hash definitions, seal → .evidence
evidence merge a.evidence b.evidence --run-id nightly -o merged.evidence --finalize
evidence verdict my-run.evidence --policy release-policy.yaml   # writes release-2.x.verdict.json beside the pack
evidence verdict --lint --policy release-policy.yaml [--catalog kane-catalog.yaml]
```

Exit codes: `0` valid / passed · `1` invalid / failed · `2` usage error ·
`3` a verdict errored (the pack could not be judged). Add `--json` for a
machine-readable report.

### Verdict policies

A policy is a list of gates over **metrics**: built-ins every pack has
(`totals.failed`, `pass_rate`, `steps.failed`, `run.duration_ms`, …) and a
producer's own `metrics.<name>`, defined in the metric catalog the producer
snapshots into the pack at `meta/metrics-catalog.yaml`. Gates compare a metric
with `equals`, `min`, `max`, `range` or `in`, can be narrowed per test with a
`where`, or are free CEL expressions:

```yaml
policy: release-2.x
gates:
  - { id: all-pass, metric: totals.failed, equals: 0, severity: blocking }
  - { id: checkout, metric: pass_rate, where: "'checkout' in test.tags", min: 0.95, severity: blocking }
  - { id: no-flaky-critical, expr: "tests.filter(t, 'critical' in t.tags).all(t, !t.flaky)", severity: warning }
```

Values are recomputed from the pack's own files wherever possible; a stored
number that disagrees with its recompute errors the gate rather than passing
it. See [the verdict contract](design/contract/03-commands.md) and decisions
0047–0050.

## What's in a pack

A pack is a `<name>.evidence/` directory (which zips to a `<name>.evidence` file),
anchored by a top-level `run.yaml`. At **L0** — the minimal profile — only three
artifacts are load-bearing:

```
<name>.evidence/
  run.yaml                 # required — manifest anchor (run identity, lifecycle, derived totals)
  tests/<id>/
    <definition>           # required, OPAQUE — the framework's own artifact (a Markdown spec, *.spec.ts, an API suite, …)
    result.yaml            # required — structured per-step outcomes
```

evidence-cli knows **nothing** about any framework's definition format. It
references and hashes the definition; it never parses it. The format scales by
*adding* optional files and profiles — never by rewriting the L0 core.

### Profiles — a ladder on one `0.1` contract

- **L0** — the minimal, framework-neutral core (above).
- **L1** — purely additive: keeps all of L0 and adds the captured **evidence
  artifacts** (per-test execution logs and step screenshots, a global coverage
  directory; video optional).

Version and profile are different axes: a profile only *adds* requirements and
never changes the version; only a breaking change to an existing meaning bumps
`evidence` (`0.1` → `0.2`).

## This repo is its own spec

`evidence-cli` is governed by a living decision log. The [`design/`](design)
directory holds the **decisions** (proposition → options → decision → reasoning),
the **contract**, and a **web viewer** that renders all of it. The **JSON
Schemas** — the single source of truth, consumed by *both* the validator and the
viewer — live under [`src/schemas/0.1/`](src/schemas).

> The decision is the unit of work. Code is downstream of it. No code lands
> without a decision; no change lands without updating the structure.

Browse it locally with `npm run docs`. See [`GOVERNANCE.md`](GOVERNANCE.md).

## Support & contributing

- **Community:** [Join us on Discord](https://discord.gg/SqVMtNeWEf) — questions,
  discussion, and release announcements.
- **Issues / bug reports:** [GitHub Issues](https://github.com/LambdaTest/evidence-cli/issues/new/choose)
- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md) — every change starts
  with a decision.
- **Security:** see [SECURITY.md](SECURITY.md).
- **Changelog:** [CHANGELOG.md](CHANGELOG.md).

## 🚀 LambdaTest is now TestMu AI

On **January 12, 2026**, [LambdaTest evolved to TestMu AI](https://www.testmuai.com/lambdatest-is-now-testmuai/),
an autonomous Agentic AI Quality Engineering Platform. Same team, same
infrastructure, same accounts — existing logins, scripts, and integrations
continue to work. Find the new home at [testmuai.com](https://www.testmuai.com).

## License

[Apache-2.0](LICENSE) © LambdaTest Inc.

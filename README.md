# evidence-cli — TestMu AI (formerly LambdaTest)

**An open, framework-agnostic format for what a test run produced — the
`.evidence` pack, and the library + CLI that validate and seal it.**

[![npm version](https://img.shields.io/npm/v/@testmuai/evidence-cli)](https://www.npmjs.com/package/@testmuai/evidence-cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/LambdaTest/evidence-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/LambdaTest/evidence-cli/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/SqVMtNeWEf)

One shape, whatever made it — a browser agent, a Playwright suite, a Jest run, an
API check. An evidence pack is readable by a CI dashboard, an auditor, or a human
without knowing the framework that wrote it.

## Install

```bash
# As a library (Node 18+)
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

The package ships type definitions; `validate` and `finalize` are the load-bearing
entry points, and the pack container types (`openContainer`, `RemoteZipContainer`,
…) are exported for reading packs directly — including ranged reads from a blob
store.

### As a CLI

```bash
evidence validate my-run.evidence --profile L0   # check a directory OR a sealed .evidence zip
evidence validate my-run.evidence --profile L1   # L1 = L0 + the captured-artifact layer
evidence finalize my-run.evidence/               # roll up totals, hash definitions, seal → .evidence
```

Exit codes: `0` valid · `1` invalid · `2` usage error. Add `--json` for a
machine-readable report.

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

- **Community:** [Join us on Discord](https://discord.gg/kanQPEx9) — questions,
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

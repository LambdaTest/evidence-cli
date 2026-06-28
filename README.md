# evidence-cli

**An open, framework-agnostic format for what a test run produced — and the CLI
that seals and validates it.**

One shape, whatever made it: a browser agent, a Playwright suite, a Jest run, an
API check. An evidence pack is readable by a CI dashboard, an auditor, or a human
without knowing the framework that wrote it.

```bash
npm i -g evidence-cli

evidence finalize my-run.evidence/          # roll up totals, hash definitions, seal → .evidence (directory only)
evidence index    my-run.evidence/          # (re)generate the optional human renders (summary.md / result.md)
evidence validate my-run.evidence --profile L0   # check a directory OR a sealed .evidence zip
```

## What's in a pack

A pack is a `<name>.evidence/` directory (which zips to a `<name>.evidence` file),
anchored by a top-level `run.yaml`. At **L0** — the minimal profile — only three
artifacts are load-bearing:

```
<name>.evidence/
  run.yaml                 # required — manifest anchor (run identity, lifecycle, derived totals)
  tests/<id>/
    <definition>           # required, OPAQUE — the framework's own artifact (kane test.md, *.spec.ts, …)
    result.yaml            # required — structured per-step outcomes
```

evidence-cli knows **nothing** about any framework's definition format. It
references and hashes the definition; it never parses it. The format scales by
*adding* optional files and profiles (L1–L3, browser, mobile, a11y, security) —
never by rewriting the L0 core.

## This repo is its own spec

`evidence-cli` is governed by a living decision log. The
[`design/`](design) directory holds the **decisions** (proposition → options →
decision → reasoning), the **contract**, the **JSON Schemas** (the single source
of truth, consumed by both the validator and the docs), and a **web viewer** that
renders all of it.

> The decision is the unit of work. Code is downstream of it. No code lands
> without a decision; no change lands without updating the structure.

See [`GOVERNANCE.md`](GOVERNANCE.md).

## Browse the design locally

```bash
npm run docs        # serves the design/ viewer at a local URL
```

## Layout

```
evidence-cli/
  design/
    decisions/     # ADRs — every choice and its reasoning
    contract/      # L0 pack layout, lifecycle, commands, config
    schemas/L0/    # JSON Schema — single source of truth
    web/           # local viewer (Vite/React)
  src/             # validate, finalize, profile/config resolution  (TypeScript)
  fixtures/        # valid-L0/, invalid-L0/  — conformance examples
```

## Status

Early. The **`0.1` contract** is being defined, starting with its minimal
**profile, L0**; richer profiles (L1–L3) follow on the *same* `0.1` contract.
Version and profile are different axes: a profile only *adds* requirements and
never changes the version, while a breaking change to an existing meaning bumps
`evidence` to `0.2`. The contract and its reasoning are tracked in
[`design/decisions/`](design/decisions) (see decision 0027).

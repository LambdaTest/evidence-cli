# Evidence — for **any** test framework

**Evidence** is an open, framework-agnostic format for what a test run produced.
One shape, whatever made it — a browser agent, a Playwright suite, a Jest run, an
API check. A pack is readable by a CI dashboard, an auditor, or a human without
knowing the framework that wrote it.

This `design/` directory is the **living spec**. It is not documentation *about*
the format that lives somewhere else — it *is* the format's source of truth, and
the [web viewer](./web) renders it.

## The four pillars

| Pillar | What it holds |
| --- | --- |
| [`decisions/`](./decisions) | Every design decision as a record: **proposition → options → decision → reasoning**. Read these to understand *why*, not just *what*. |
| [`contract/`](./contract) | The contract in prose: L0 pack layout, lifecycle & verdicts, commands & config — plus the additive **L1** profile. |
| [`profiles.yaml`](./profiles.yaml) | The additive profile ladder (L0 → L1 → …) on the one `0.1` contract. |
| [`../src/schemas/0.1/`](../src/schemas/0.1) | The JSON Schemas — the **single source of truth**, consumed by both the validator and this viewer. Version-first (`0.1/L0`, `0.1/L1`); they live under `src/` because code imports them directly (decision 0038). |
| [`web/`](./web) | A local site that renders all of the above. |

## What L0 is

L0 is the **minimal** profile. A pack is a `<name>.evidence/` directory (which
zips to a `<name>.evidence` file) anchored by a top-level `run.yaml`. The only
load-bearing artifacts are:

- **`run.yaml`** — the run manifest (identity, lifecycle, derived totals).
- **`tests/<id>/<definition>`** — what was tested, **opaque** to evidence-cli.
- **`tests/<id>/result.yaml`** — what happened, as structured per-step outcomes.

Everything else is optional and additive. The format scales by *adding* — L1, L2,
L3 and orthogonal profiles never rewrite the L0 core. Profile and *version* are
distinct axes: the `evidence` version (`"0.1"`) is the contract spanning every
profile, and only a breaking change bumps it — adding a profile never does (see
decision 0027).

## Why a decision log gates the code

evidence-cli will be open-sourced and adopted by frameworks we do not control. So
the repo inverts the usual order: **the decision is the unit of work, and code is
downstream of it.** No code lands without a decision; no code change lands without
updating this structure. See [`GOVERNANCE.md`](../GOVERNANCE.md) and decision
[0001 — Decisions gate code](./decisions/0001-decisions-gate-code.md).

## Run the viewer

```bash
npm run docs        # from the repo root — serves the design/ viewer locally
```

## The shape at a glance

```
<name>.evidence/
  run.yaml                 # required — manifest anchor
  tests/<id>/
    <definition>           # required, opaque (kane: test.md, Playwright: *.spec.ts)
    result.yaml            # required — per-step outcomes
```

```yaml
# run.yaml — verdict roll-up is DERIVED by `evidence finalize`
evidence: "0.1"
run_id: 2026-06-19-smoke-7f3a
status: finalized          # running → finalized | aborted
title: Nightly smoke
totals: { tests: 5, passed: 2, failed: 2, broken: 1, skipped: 0 }
```

```yaml
# tests/card-payment/result.yaml — verdict authored, structure parseable
evidence: "0.1"
test: card-payment
status: broken             # passed | failed | broken | skipped
definition: { path: test.md, sha256: "sha256:…" }   # sha256 added at finalize
steps:
  - { id: open-checkout, ordinal: 1, status: passed }
  - { id: confirm-payment, ordinal: 3, status: broken }
```

# Changelog

All notable changes to evidence-cli are documented here. This format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0] — Unreleased

- **Verdict** — `evidence verdict <pack> --policy <file>…` judges a sealed pack
  against one or more policies and writes `<policy-id>.verdict.json` beside the
  pack, never into it. A policy is a list of gates: a metric with one operator
  (`equals`/`min`/`max`/`range`/`in`), optionally narrowed per test with
  `where`, or a boolean CEL `expr`. Exit `0` pass · `1` fail · `3` errored ·
  `2` usage, which includes a policy that does not check clean against the
  pack's catalog (every problem listed). `--lint` checks policies with no pack
  (against `--catalog` when given) and reports every problem at once with a
  line and a hint. Missing values error a gate rather than reading as 0: an
  aggregate whose kept test lacks the path, a merged source (at any depth)
  that stored no value, a pack older than a metric's `min_producer`.
  Expressions are bounded by fact reads and by evaluation steps. Library:
  `verdict`, `lintPolicy`, `judge`, `loadPackFacts`, `loadPolicy`,
  `loadCatalog`, `writeVerdicts`. See decisions 0047, 0049, 0050.
- **Metric catalogs** — one format for the built-in `evidence-core` catalog
  (`totals.*`, `pass_rate`, `steps.*`, `run.duration_ms`, `run.status`,
  `failures.count`) and producer catalogs. A producer snapshots its catalog to
  `meta/metrics-catalog.yaml` and records `run.yaml` `metrics_catalog`
  (additive); `validate` checks the snapshot, its hash and identity, and
  `merge` keeps it when every source carries the same one. See decision 0048.
- **Merge report** gains `output.endedAt`: the seal time, the latest `ended`
  (else `started`) among the eligible packs, reported with or without
  `--finalize`, so a caller that seals the merged pack itself stamps the same
  time. Additive.
- **Diagnostics** gain optional `hint`, `line` and `column`.
- **Node** — requires Node 20.19 or newer (the CEL library is an ES module).
- The CLI's `--version` now reports the package version.

## [0.1.7] — 2026-07-20

- **Merge identity grouping** — an optional `tests.identity` block in
  merge-rules turns a test-id collision from "pick one winner" into "group by
  identity". `keys` (dot-paths into `result.yaml`, the caller's vocabulary) decide
  sameness; `on_same: nest` keeps every copy — the latest run holds the canonical
  `tests/<id>/` and superseded runs are archived beneath it as `1/`, `2/` …
  oldest first — while `on_different: split` gives a distinct test its own
  sibling `tests/<id>-1/`. Guard rules still resolve first, so a
  `must: same` + `error` rule can never be downgraded into a split. Nested
  copies are inert to totals, the failure index and validation.
  `MergeReport` collisions gain optional `action`/`folder`. Purely additive —
  absent the block, merge behaves exactly as before. See decision 0046.

## [0.1.6] — 2026-07-19

- **Windows seal reliability** — `finalize` retries transient lock errors
  (`EPERM`/`EACCES`/`EBUSY`) around the atomic seal, with `.tmp` removal
  retries and a ~15s seal-rename budget, so a scanner or indexer holding a
  handle no longer fails the seal.

## [0.1.5] — 2026-07-08

- **Merge** — `evidence merge` combines N packs under a declarative merge-rules
  policy (pack gates + per-test collision resolution, generic
  `{file, key, must, on_violation}` predicates); merge assembles a live pack,
  finalize derives and seals (`--finalize`). See decision 0045.

## [0.1.4] — 2026-07-07

- **Failure `title`** — a step-level `failure.yaml` MAY carry a short
  defect-style `title` (open string, never cross-checked); `finalize` lifts it
  verbatim into the run-level failure index row, so triage queues and
  dashboards get a name, not just a status. Purely additive — records without
  a title index exactly as before.

## [0.1.0] — Unreleased

Initial public release of the `0.1` evidence contract.

- **L0** — the minimal profile: the `.evidence` pack (`run.yaml` manifest anchor,
  per-test `result.yaml`, and the opaque, framework-owned definition); `validate`
  (status-gated conformance checking, directory or sealed zip) and `finalize`
  (derive totals + definition hashes and seal, atomically, to a flat zip).
- **L1** — the additive evidence-artifact profile: per-test execution logs and
  step screenshots, and a global coverage directory (video optional).
- **Failure records** — a structured per-step `failure.yaml` (expected/actual,
  error, page state, strict triage block) plus a run-level failure index that
  `finalize` generates at the pack root.
- **Range-addressable packs** — read only the entries you need from a sealed pack
  on a blob store, without downloading the whole zip.
- **Library + CLI** — `import { validate, finalize } from "@testmuai/evidence-cli"`,
  or the `evidence` command.

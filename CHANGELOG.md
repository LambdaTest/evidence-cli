# Changelog

All notable changes to evidence-cli are documented here. This format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

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

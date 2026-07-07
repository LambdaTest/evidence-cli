# Changelog

All notable changes to evidence-cli are documented here. This format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

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

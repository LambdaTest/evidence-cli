---
id: 43
slug: environment-at-result-level
title: Environment is also expressible per-test (result level)
status: accepted
date: 2026-07-01
proposition: >
  `environment` lives only at run level (0013), but different tests in one run
  can execute in different environments — cross-browser matrices, sharding across
  heterogeneous machines, and (crucially) merged evidence where each source run
  had its own environment. Should environment be expressible per test, and how
  does a per-test block relate to the run-level one?
options:
  - id: environment-both-levels
    summary: >
      Add an OPTIONAL `environment` (same open key:value shape) to result.yaml, so
      per-test execution context can be recorded. The spec carries the fields at
      both levels; how a consumer combines run-level and result-level is left
      entirely to the consumer. Purely additive.
    chosen: true
  - id: move-to-result-only
    summary: >
      Move `environment` wholly to result.yaml.
    chosen: false
  - id: run-level-only
    summary: >
      Keep environment run-level only (status quo).
    chosen: false
decision: >
  `environment` is an OPTIONAL open key:value map at BOTH run and result level.
  The run-level block (0013) records the run's context; a result-level
  `environment` records a single test's execution context. The format's job is to
  CARRY these facts — it does NOT prescribe how the two levels relate: whether
  result refines run, which wins on a shared key, or how they merge is entirely a
  CONSUMER concern (a dashboard or viewer reads them however it sees fit). Nothing
  is required at either level, so the L0 mandatory cut (0015) is untouched and a
  homogeneous run may write environment once, at run level, or per test, or not at
  all. This is purely additive on the `0.1` contract (0027) — an optional field on
  result.yaml, no version bump, no L0 pack invalidated. The validator checks the
  block's shape when present and nothing more.
governs:
  - src/schemas/0.1/L0/result.schema.json#/properties/environment
feature: [result-model]
depends_on: [13, 15, 27]
supersedes: []
---

## Reasoning

`environment` was conflating two different kinds of fact with two different
natural homes:

- **Provenance** — `producer`, `ci`. A fact about *the run as a whole*: one seal =
  one production event. Genuinely run-level; it does not vary per test.
- **Execution context** — `surfaces` (browser), `model`, and later os/device/
  viewport. A fact about *how a given test executed* — which legitimately varies
  test to test.

On a single homogeneous run the two coincide, so [run-level](0013-environment-optional.md)
works and reads cleanly. The moment tests diverge — a cross-browser matrix, shards
on heterogeneous machines, or a merge — execution context becomes per-test and a
run-level-only block can no longer hold it.

**Why not move it wholly to result level.** That would repeat the same block
across every test in the common (homogeneous) case — wasteful and drift-prone —
and would strip the genuinely run-level provenance (`producer`, `ci` build) that
belongs on the pack as a whole. So run-level stays the baseline; result-level is
an optional refinement. In the common case you still write environment exactly
once.

**Why the merge feature forces this.** Merging N single-environment packs into one
produces a single `run.yaml` with a single environment slot, but each source had
its own. Run-level-only environment makes the merge lossy — you must discard all
but one, or invent a synthetic "merged" environment, and can no longer answer
"what did `checkout` run on?". With a result-level block the merge is lossless:
each source's run-level environment is pushed down onto its tests (or left where
it already is), and the merged `run.yaml` keeps only the common subset. The same
divergence also drives merge *identity* — two packs each with `tests/checkout/`
must be disambiguated on merge, and the per-test environment is exactly what
distinguishes them — so solving environment at result level now lays the
groundwork rather than forcing a retrofit after `0.1` packs exist in the wild.

**Why additive, and why the spec does not resolve it.** Adding an optional field
to result.yaml is "add an optional field" under [0027](0027-evidence-version-and-profiles.md) —
it stays on `0.1` and never invalidates an existing pack. And the format
deliberately stops at carrying the facts: how run-level and result-level
environment relate (precedence, merge, inheritance) is left to the consumer that
reads them. This is the same restraint the format applies elsewhere — it fixes
*structure*, not *interpretation*, and stays a checker rather than an interpreter
([authored test status](0016-test-status-authored.md), open
[`kind`](0009-step-kind-open-string.md)/[`type`](0012-typed-free-form-metrics.md)).
evidence-cli only validates the block's shape when present.

## Consequences

- `result.schema.json` gains an optional `environment` — the same open key:value
  object as run-level (conventional `producer`/`model`/`surfaces`/`ci`, none
  required, arbitrary keys allowed).
- No resolution rule is mandated: consumers decide how (or whether) to combine the
  run-level and result-level blocks. The validator checks shape only.
- [0013](0013-environment-optional.md) gains a cross-reference: environment now
  appears at both levels; 0013's run-level rules are unchanged.
- Future merge is unblocked — per-test environment gives each test a place to
  carry its own context — without the format having to define merge semantics
  here.

---
id: 18
slug: status-gated-validation
title: Validation is gated on run status
status: accepted
date: 2026-06-26
proposition: >
  `ended`, `totals`, and definition hashes only exist after finalize. How should
  `validate --profile L0` treat a pack depending on its run status?
options:
  - id: status-gated
    summary: running/aborted → structure-only; finalized → full seal with consistency checks.
    chosen: true
  - id: finalized-only-input
    summary: validate always demands the full sealed set; validating a running pack is an error.
    chosen: false
decision: >
  Validation is status-gated. `running` and `aborted` packs get structure-only
  checks (anchor + identity fields present, each test has result.yaml + a declared
  `definition.path` whose file EXISTS — only the hash waits for finalize). A
  `finalized` pack gets the full seal: `ended` and `totals` present, totals
  consistent with the rolled-up verdicts, and every `definition.{path,sha256}`
  present with the file existing and hash-matching. The full enumeration of
  non-schema checks lives in [decision 0031](0031-validator-cross-checks.md).
governs:
  - src/
  - design/schemas/L0/run.schema.json#/allOf
feature: [validate]
depends_on: [7, 11, 5]
supersedes: []
---

## Reasoning

A [`running`](0007-run-lifecycle.md) pack is mid-flight: `ended`, `totals`, and
definition *hashes* do not exist yet, so demanding them would produce false
failures on a perfectly healthy in-progress pack. Gating on status lets the
validator be useful at every stage — it checks what *should* be true given where
the run is. Note the definition *file* is held to a different bar than its hash:
it is the framework's own artifact, authored when the test is defined, so it must
exist even while `running` — only the [hash](0005-definition-located-by-path.md)
is deferred to finalize.

`finalized` is the sealed state, so it gets the teeth: totals must agree with the
per-test [verdicts](0011-totals-derived-by-finalize.md), and the
[definition](0005-definition-located-by-path.md) files must exist and hash-match.
`aborted` is treated like `running` (structure-only) — it never got sealed, so we
do not hold it to the sealed contract.

This is encoded partly in the schema (an `if status==finalized then require
ended+totals`) and partly in validator logic (totals-vs-verdicts consistency,
file existence, hash match) that pure JSON Schema cannot express.

## Consequences

- The run schema carries the conditional `ended`/`totals` requirement.
- The validator implements the cross-file consistency and integrity checks for
  finalized packs.

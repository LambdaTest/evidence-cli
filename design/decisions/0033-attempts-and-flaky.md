---
id: 33
slug: attempts-and-flaky
title: attempts is a per-attempt outcome list; flaky derives from it
status: accepted
date: 2026-06-28
proposition: >
  `result.yaml` carries optional `attempts` and `flaky`. `flaky` was described as
  "true when attempt statuses disagree" — but `attempts` was a bare integer
  count, so there were no per-attempt statuses to disagree. How are retries
  modelled?
options:
  - id: attempts-array-with-status
    summary: >
      `attempts` is an optional array of per-attempt objects, each with a
      `status` from the verdict enum. Array length is the retry count; `flaky`
      derives from disagreement among the attempt statuses.
    chosen: true
  - id: count-plus-statuses
    summary: Keep `attempts` an integer and add a parallel `attempt_statuses` array.
    chosen: false
  - id: drop-flaky
    summary: Keep `attempts` an integer count and remove `flaky`.
    chosen: false
decision: >
  `attempts` is an OPTIONAL array of per-attempt outcomes. Each entry is an object
  with a required `status` drawn from the SAME verdict enum as the test
  (`passed | failed | broken | skipped`), plus optional detail. The array length
  is the attempt count; the test-level `status` remains the authoritative final
  verdict. `flaky` is optional and means "the attempt statuses disagree" — now a
  real derivation over `attempts`, not a reference to absent data.
governs:
  - design/schemas/L0/result.schema.json#/properties/attempts
  - design/schemas/L0/result.schema.json#/properties/flaky
feature: [result-model]
depends_on: [6, 15]
supersedes: []
---

## Reasoning

A bare `attempts: 3` count cannot support `flaky = "attempt statuses disagree"` —
the data it refers to (each attempt's outcome) simply wasn't there. Modelling
`attempts` as a list of per-attempt outcomes fixes the dangling reference and
costs nothing for the common single-run case (the field is optional and omitted
entirely).

Reusing the [verdict enum](0006-verdict-enum.md) for the attempt `status` keeps
the format small — no second vocabulary for "how did an attempt end" — and makes
"flaky" precise: a test whose attempts are e.g. `failed` then `passed` is flaky;
one with `passed`, `passed` is not. The count survives as the array length, so
nothing is lost by dropping the scalar. The final verdict stays
[authored at the test level](0016-test-status-authored.md); `attempts` is the
trail behind it, not a competing verdict.

This stays within the [L0 mandatory cut](0015-result-yaml-mandatory-cut.md):
`attempts` and `flaky` are both optional, validated only when present.

## Consequences

- `attempts` becomes `array<object>` with each item requiring `status` (verdict
  enum); other per-attempt fields (e.g. `duration_ms`) are optional.
- `flaky` stays an optional boolean; its description points at `attempts`.
- A producer that doesn't retry simply omits `attempts`.

---
id: 30
slug: step-ordinal-semantics
title: Step ordinal — unique, strictly increasing, gaps allowed
status: accepted
date: 2026-06-28
proposition: >
  A step has a 1-based `ordinal`. Must ordinals be unique? Contiguous (1,2,3,…)?
  Match array order? An example shows steps at ordinal 1 and 3 — is that legal?
options:
  - id: unique-increasing-gaps-ok
    summary: >
      Ordinals are unique and strictly increasing in array order; gaps are
      allowed (a producer may omit a step it didn't record). Not required to be
      contiguous.
    chosen: true
  - id: contiguous-1-to-n
    summary: Ordinals must be exactly 1..N with no gaps, matching array length.
    chosen: false
  - id: free-integer
    summary: Any integer ≥ 1, no uniqueness or ordering rule.
    chosen: false
decision: >
  Within a test, step `ordinal` values MUST be unique and strictly increasing in
  array order. They are NOT required to be contiguous — a producer may leave gaps
  (e.g. ordinals 1 and 3) when it records only some of a longer conceptual
  sequence. `ordinal` is the step's position in the producer's sequence, not an
  index into the `steps[]` array.
governs:
  - design/schemas/L0/result.schema.json#/$defs/step/properties/ordinal
feature: [result-model]
depends_on: [8]
supersedes: []
---

## Reasoning

[Steps are execution-derived and the producer chooses granularity](0008-steps-execution-derived.md);
it may legitimately record a subset of a longer sequence, which is why the spec's
own example shows ordinals 1 and 3 with no step 2. So **contiguity cannot be
required** — it would invalidate honest partial traces.

But two steps claiming the same position, or positions that run backwards
relative to array order, are meaningless and almost always a producer bug. So we
require **uniqueness** and **strict increase in array order**: enough to make
ordinals a real, sortable sequence and to let a reader detect "a step is missing
here," without forcing producers to renumber when they drop a step. This makes
`ordinal` carry information the array index cannot (it survives omission), which
is the only reason to have it alongside array position at all.

## Consequences

- The schema keeps `ordinal` as `integer ≥ 1` and documents "unique, strictly
  increasing in array order, gaps allowed."
- Uniqueness and monotonicity are a [validator cross-check](0031-validator-cross-checks.md)
  (JSON Schema cannot compare array siblings); a violation is an error, a gap is not.

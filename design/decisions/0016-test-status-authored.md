---
id: 16
slug: test-status-authored
title: Test status is authored, not derived
status: accepted
date: 2026-06-26
proposition: >
  Is a test's verdict computed by evidence-cli from its steps, or authored by the
  producer?
options:
  - id: authored
    summary: The producer authors the test status; evidence-cli does not compute it.
    chosen: true
  - id: derived
    summary: evidence-cli derives the test status from the worst step.
    chosen: false
decision: >
  The test-level `status` is authored by the producer. evidence-cli does not
  compute it, because `steps[]` may be empty and the framework may have its own
  rollup rules. At most, the validator MAY warn if an authored status disagrees
  with the steps; it never overrides.
governs:
  - design/schemas/L0/result.schema.json#/properties/status
feature: [result-model]
depends_on: [8, 6]
supersedes: []
---

## Reasoning

Deriving the verdict from steps assumes steps exist and that "worst step wins" is
universal. Neither holds: [steps may be empty](0008-steps-execution-derived.md)
(a unit test), and frameworks legitimately differ on how step outcomes roll up
into a test verdict. The producer is the authority on its own result, so it
authors `status`.

evidence-cli stays a checker, not a judge: it can *warn* on an obvious
disagreement (e.g. a `passed` test with a `failed` step) as a quality hint, but
it will not recompute or overwrite the producer's verdict. The run-level
[`totals`](0011-totals-derived-by-finalize.md), by contrast, *are* derived —
because they are a pure projection of the authored per-test verdicts, not a
re-judgment of them.

## Consequences

- The result schema treats `status` as an authored enum value.
- Any step-vs-test consistency check in the validator is advisory (a warning),
  not a hard failure.

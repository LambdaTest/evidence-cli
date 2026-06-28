---
id: 6
slug: verdict-enum
title: Verdict enum — passed, failed, broken, skipped
status: accepted
date: 2026-06-26
proposition: >
  What verdict vocabulary does a test (and a step) use, and must it distinguish
  "the product is wrong" from "we couldn't tell"?
options:
  - id: four-value-allure-style
    summary: passed | failed | broken | skipped, where broken = oracle could not be evaluated.
    chosen: true
  - id: pass-fail
    summary: Just passed | failed.
    chosen: false
  - id: add-unknown-running
    summary: Add a fifth value like unknown/running.
    chosen: false
decision: >
  The verdict enum is `passed | failed | broken | skipped`, used identically at
  test level and step level. `failed` = the oracle was evaluated and the product
  was wrong (a real defect). `broken` = the oracle could NOT be evaluated
  (environment / infrastructure / test fault). `skipped` = not executed.
governs:
  - src/schemas/0.1/L0/result.schema.json#/properties/status
  - src/schemas/0.1/L0/result.schema.json#/$defs/step/properties/status
feature: [result-model]
depends_on: []
supersedes: []
---

## Reasoning

Conflating "the product is broken" with "we couldn't run the check" destroys the
signal a results format exists to carry. An auditor reading a pack needs to know
whether a red test means a bug or a flaky environment. The four-value model
(as popularized by Allure) draws exactly that line: `broken` is an oracle that
could not render a judgment, distinct from `failed` which is a judgment against
the product.

Using the same four values at step and test level keeps the format small and
lets a test verdict be reasoned about against its steps without a second
vocabulary. Run *lifecycle* (running/finalized/aborted) is a
[separate enum](0007-run-lifecycle.md) on `run.yaml` — it is not a verdict, so it
does not belong here.

## Consequences

- `result.yaml` test `status` and each step `status` share this enum.
- `run.yaml.totals` rolls up counts across exactly these four buckets.
- The forensic detail explaining a `failed`/`broken` step (expected/actual/
  defect) is [optional at L0](0015-result-yaml-mandatory-cut.md).

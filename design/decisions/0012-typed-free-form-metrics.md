---
id: 12
slug: typed-free-form-metrics
title: Typed free-form metrics
status: accepted
date: 2026-06-26
proposition: >
  Runs carry metrics (pass_rate, determinism, tokens, ...). How are they
  represented so any framework can define its own, while a reader still knows how
  to interpret each number?
options:
  - id: object-per-metric
    summary: Each metric is an object with value + type (+ optional unit/label).
    chosen: true
  - id: typed-registry
    summary: Flat values plus a sibling block declaring each metric's type.
    chosen: false
  - id: namespaced-by-type
    summary: Group metrics under their type.
    chosen: false
decision: >
  `metrics` is an open map. Each metric is an object `{ value, type }` (with
  optional `unit`/`label`). `type` is an open string declared by the producer.
  Metrics are FACTS, never verdicts.
governs:
  - design/schemas/L0/run.schema.json#/properties/metrics
feature: [run-model]
depends_on: [2, 6]
supersedes: []
---

## Reasoning

Two requirements pull together here: frameworks must be able to coin their own
metrics ([agnostic](0002-framework-agnostic.md)), but a bare number is
uninterpretable — is `0.9` a percentage, a ratio, a count? Attaching a `type` to
each metric makes every metric self-describing without evidence-cli knowing the
metric in advance. The object-per-metric shape keeps a metric's identity, value,
and type in one place rather than split across sibling blocks.

`type` is an [open string](0009-step-kind-open-string.md) for the same reason
`kind` is: the format fixes the *structure*, the framework supplies the
*vocabulary*. evidence-cli validates that `value` and `type` are present, not
what `type` says.

Metrics are explicitly facts, not judgments. The verdict lives only in
[`status`/`totals`](0006-verdict-enum.md); `metrics` never carries a pass/fail
meaning. This keeps the one place a pack says "good or bad" unambiguous. For the
same reason a metric `value` is `number | integer | string` and **not** boolean:
a bare `true`/`false` reads as a verdict, which is exactly what a metric must
never be. A producer that wants a flag emits it as a typed string.

## Consequences

- The run schema models `metrics` as `additionalProperties` → `{ value, type, ... }`,
  with `value` constrained to `number | integer | string` (no boolean).
- A non-browser framework simply emits a different metric set; nothing is required.

---
id: 14
slug: lineage-deferred
title: Lineage is deferred past v0.1
status: accepted
date: 2026-06-26
proposition: >
  Runs can chain or split (continues_from / part). Should lineage be part of L0
  v0.1?
options:
  - id: defer
    summary: Leave lineage out of v0.1; reintroduce it later as an additive field.
    chosen: true
  - id: include-now
    summary: Include lineage in L0 now.
    chosen: false
decision: >
  Lineage (`continues_from`, `part`) is out of scope for v0.1. It will return
  later as a purely additive run.yaml field.
governs:
  - design/contract
feature: [run-model]
depends_on: [10]
supersedes: []
---

## Reasoning

L0 is the minimal first step. Run chaining/splitting is real but not needed to
make a single pack useful, identifiable, and valid — which is all L0 must
deliver. The format is designed to scale by *adding* optional fields, never by
migrating or rewriting, so deferring lineage costs nothing: it can be introduced
later without invalidating any L0 pack.

Keeping v0.1 small also keeps the [validator](0017-commands-validate-and-finalize.md)
and the [schemas](0024-schemas-single-source-of-truth.md) easy to reason about
while the format finds its feet.

## Consequences

- `lineage` is not in the L0 run schema. Unknown top-level keys are tolerated, so
  a producer emitting lineage early will not be rejected — it simply is not
  validated at L0.

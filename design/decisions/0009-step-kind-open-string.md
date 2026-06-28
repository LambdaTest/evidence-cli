---
id: 9
slug: step-kind-open-string
title: Step kind is an open string
status: accepted
date: 2026-06-26
proposition: >
  A step has a `kind` (navigate, input, assertion, ...). Should evidence-cli
  enforce a fixed vocabulary or leave it open?
options:
  - id: open-string
    summary: kind is an OPTIONAL open string; when present it must be non-empty; evidence-cli never checks its vocabulary.
    chosen: true
  - id: fixed-enum
    summary: evidence-cli ships a fixed neutral enum and rejects unknown kinds.
    chosen: false
decision: >
  `kind` is OPTIONAL. When a step carries it, it must be a non-empty string;
  evidence-cli validates that non-emptiness but never the vocabulary. A step is
  not required to declare a `kind` (a unit/API step may have none). Frameworks
  coin their own kinds.
governs:
  - design/schemas/L0/result.schema.json#/$defs/step/properties/kind
feature: [result-model]
depends_on: [2, 8]
supersedes: []
---

## Reasoning

`navigate | input | assertion` are browser-automation kinds. A Jest unit test or
an API suite has none of them. Hard-coding that enum would quietly make the
format browser-shaped and demote every other framework — the opposite of
[framework-agnostic](0002-framework-agnostic.md).

So the format supplies the *slot* (`kind`) and the framework supplies the
*vocabulary*. evidence-cli only checks the slot, *when filled*, is non-empty —
it never requires the slot nor inspects the value. This mirrors the same choice
for metric [`type`](0012-typed-free-form-metrics.md): structure is fixed,
vocabulary is open. `kind` sits among the optional step fields of the
[L0 mandatory cut](0015-result-yaml-mandatory-cut.md) — only `id`, `ordinal`,
and `status` are required on a step.

## Consequences

- The schema does NOT list `kind` in a step's `required`; when present it must be
  a non-empty string, nothing more.
- The contract docs may *suggest* a common set (navigate/input/assertion/wait/
  api/setup) without enforcing it.

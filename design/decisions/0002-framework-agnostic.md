---
id: 2
slug: framework-agnostic
title: Framework-agnostic by construction
status: accepted
date: 2026-06-26
proposition: >
  evidence-cli will be used by many test frameworks (kane, Playwright, Cypress,
  Jest, API suites...). How much may the format know about any one of them?
options:
  - id: knows-nothing
    summary: evidence-cli knows nothing about any framework's definition format; the definition artifact is opaque.
    chosen: true
  - id: neutral-definition-schema
    summary: Define one neutral definition format every framework must translate into.
    chosen: false
  - id: kane-shaped
    summary: Model the format around kane's test.md and let others adapt.
    chosen: false
decision: >
  evidence-cli knows NOTHING about any framework's test definition. It never
  parses test.md, .spec.ts, `## objective`, or any native artifact. The
  definition is referenced and hashed, never read.
governs:
  - design/schemas/L0/result.schema.json#/properties/definition
feature: [definition]
depends_on: []
supersedes: []
---

## Reasoning

The value of evidence is that it is the *same* shape no matter what produced
it — a CI dashboard, an auditor, or a human can read a pack without knowing the
framework. The moment the format encodes one framework's concepts, it stops
being neutral and every other framework becomes a second-class citizen.

So the per-test "definition" is [required but opaque](0004-definition-required-but-opaque.md):
evidence-cli asserts it exists and records its hash, but its bytes are the
framework's business. kane points `definition.path` at `test.md`; Playwright
points it at `login.spec.ts`. evidence-cli treats both identically.

This is also why step `kind` is an [open string](0009-step-kind-open-string.md)
and metric `type` is [open](0012-typed-free-form-metrics.md): a unit test has no
`navigate` step and an API suite computes no `determinism`. The format provides
*structure*, the framework provides *vocabulary*.

## Consequences

- Nothing kane-specific may enter `design/schemas/` or `src/`. Reviews enforce this.
- Cross-framework comparability is structural (same files, same enums), not
  semantic (we do not claim a kane "assertion" equals a Cypress one).
- Frameworks integrate by *emitting* the format, not by translating into a
  foreign definition schema.

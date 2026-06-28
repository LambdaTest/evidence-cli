---
id: 4
slug: definition-required-but-opaque
title: The definition is required but opaque
status: accepted
date: 2026-06-26
proposition: >
  Every test has a "definition" (what it tests) authored in the framework's own
  format. Since evidence-cli cannot know that format, how should L0 treat it?
options:
  - id: required-but-opaque
    summary: Each test dir MUST contain a definition file; evidence-cli checks presence (and hash) but never parses content.
    chosen: true
  - id: optional
    summary: The definition is optional; L0 requires only run.yaml + result.yaml.
    chosen: false
  - id: neutral-schema
    summary: evidence-cli defines its own neutral definition schema every framework maps into.
    chosen: false
decision: >
  Every test directory MUST contain a definition artifact. evidence-cli asserts
  it exists and records its content hash, but treats the bytes as opaque — it
  never parses them.
governs:
  - design/schemas/L0/result.schema.json#/properties/definition
feature: [definition]
depends_on: [2]
supersedes: []
---

## Reasoning

Two pulls: every result should trace to *what was tested* (so "required"), but
evidence-cli must stay [framework-agnostic](0002-framework-agnostic.md) (so
"opaque"). Required-but-opaque satisfies both — the pack always records a
definition, and evidence-cli never needs to understand it.

Making it optional would let a pack validate with no record of what it tested —
weak provenance. Defining a neutral definition schema would force every
framework to translate its native artifact and would smuggle test semantics back
into a format that is meant to have none.

The definition is [located by a path the framework pre-declares](0005-definition-located-by-path.md),
so evidence-cli never has to guess a filename.

## Consequences

- A finalized test dir without its declared definition file fails validation.
- evidence-cli records `definition.sha256` for integrity but offers no parsing,
  search, or rendering of definition content — that is the framework's job.

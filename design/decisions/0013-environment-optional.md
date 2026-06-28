---
id: 13
slug: environment-optional
title: Environment is an optional block
status: accepted
date: 2026-06-26
proposition: >
  run.yaml can carry an `environment` block (producer, model, surfaces, ci).
  What is its status at L0 v0.1?
options:
  - id: optional-block
    summary: environment is allowed and validated if present, but nothing inside is required.
    chosen: true
  - id: producer-required
    summary: Require environment.producer{name,version}.
    chosen: false
  - id: drop
    summary: Defer environment entirely, like lineage.
    chosen: false
decision: >
  `environment` is optional and is an OPEN map of key:value pairs. A few keys are
  documented as conventional (`producer`, `model`, `surfaces`, `ci`), but none is
  required and any additional key:value pairs are allowed. If present it is
  checked only for being an object; nothing inside it is required at L0. A
  non-browser framework may omit model/surfaces — or the whole block — entirely.
governs:
  - design/schemas/L0/run.schema.json#/properties/environment
feature: [run-model]
depends_on: [10, 2]
supersedes: []
---

## Reasoning

`environment` is genuinely framework- and context-dependent: a Jest run has no
`model` or `surfaces`; a local run has no `ci`. Mandating any sub-field would
either be meaningless for some producers or push browser/agent assumptions into
the neutral core. So at L0 the whole block is optional, kept available for
producers that have provenance to record.

We considered requiring `producer{name,version}` for guaranteed provenance, but
chose minimalism for v0.1 — provenance can be promoted to required at a higher
level without breaking L0 packs (the format scales by adding requirements, never
by rewriting). Fully dropping it (like [lineage](0014-lineage-deferred.md)) would
needlessly discard a useful, harmless slot many producers will want.

## Consequences

- The run schema defines `environment` as an open object: known optional sub-keys
  (`producer`/`model`/`surfaces`/`ci`) are documented, none is required, and
  arbitrary additional key:value pairs are permitted.

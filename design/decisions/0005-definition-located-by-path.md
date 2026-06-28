---
id: 5
slug: definition-located-by-path
title: Definition located by a pre-declared path; finalize adds the hash
status: accepted
date: 2026-06-26
proposition: >
  If the definition is opaque and its filename varies by framework (test.md,
  login.spec.ts, ...), how does evidence-cli locate it to assert presence and
  record its hash?
options:
  - id: framework-declares-path
    summary: The framework writes `definition.path` in result.yaml (its native filename); `finalize` computes and adds `sha256`.
    chosen: true
  - id: reserved-names
    summary: Reserve known filenames; whatever non-reserved file remains is the definition.
    chosen: false
  - id: flag
    summary: Pass the definition filename to `finalize` via a flag.
    chosen: false
decision: >
  Before finalize, the framework declares `definition: { path: <native-name> }`
  in result.yaml. `evidence finalize` reads that path, computes the content hash,
  and writes `definition.sha256` back. evidence-cli never guesses a filename.
governs:
  - design/schemas/L0/result.schema.json#/properties/definition
feature: [definition, finalize]
depends_on: [4]
supersedes: []
---

## Reasoning

The framework owns naming, so the framework should name the file. A pre-declared
`path` keeps evidence-cli [agnostic](0002-framework-agnostic.md): it does not
reserve names, infer from directory contents, or push naming knowledge into the
command line. The pack is self-describing.

Splitting authorship is deliberate: `path` is authored by the producer (it knows
its own filename); `sha256` is derived by [`finalize`](0017-commands-validate-and-finalize.md)
(integrity is evidence-cli's concern, computed when the pack is sealed). A
finalized pack therefore carries both; a still-`running` pack may carry only
`path`.

## Consequences

- `result.yaml` schema requires `definition.path`; `sha256` is added at finalize.
- `validate` on a [finalized](0018-status-gated-validation.md) pack checks that
  the file at `path` exists and that its hash matches `sha256`.

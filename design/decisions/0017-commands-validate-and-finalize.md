---
id: 17
slug: commands-validate-and-finalize
title: Stage-one commands — validate and finalize
status: accepted
date: 2026-06-26
proposition: >
  What is the command surface for the first stage (L0 v0.1)?
options:
  - id: validate-and-finalize
    summary: Two verbs — finalize (derive + seal) and validate (status-gated check).
    chosen: true
  - id: validate-finalize-init
    summary: Add an init scaffolder.
    chosen: false
  - id: validate-only
    summary: Ship validate only; totals computed elsewhere.
    chosen: false
decision: >
  Stage one ships two commands. `evidence finalize <dir>` rolls up totals from
  every result.yaml, computes and writes each `definition.sha256`, sets
  `status: finalized`, and seals the pack to a `<name>.evidence` zip.
  `evidence validate <target> --profile L0` runs the status-gated checks on a
  directory or a zip.
governs:
  - src/
feature: [validate, finalize]
depends_on: [11, 5, 3]
supersedes: []
---

## Reasoning

The design already implies these two verbs. Because
[totals are derived by finalize](0011-totals-derived-by-finalize.md) and the
[definition hash is added at finalize](0005-definition-located-by-path.md),
`finalize` must exist as an evidence-cli operation — the framework does not
hand-write those. And the whole point of an open format is a conformance check,
so `validate` must exist.

`finalize` is the operation that flips the [lifecycle](0007-run-lifecycle.md) to
`finalized` and produces the sealed [zip](0003-pack-model-and-manifest-anchor.md),
deriving totals and definition hashes atomically. `validate` is
[status-gated](0018-status-gated-validation.md): structure-only while running,
full seal once finalized.

We deferred an `init` scaffolder — nice DX, but not needed to define or check the
format. It can be added later as purely additive surface. (A third verb,
[`evidence index`](0034-index-command.md), was subsequently added on the same
"purely additive surface" grounds to own the optional human renders;
[`finalize` takes only the live directory](0035-finalize-targets-live-directory.md),
while `validate` takes a directory or a zip.)

## Consequences

- `src/` implements `finalize` (derive + seal) and `validate` (check).
- Proposed CLI conventions: exit `0` valid / `1` invalid / `2` usage error;
  human output by default, `--json` for machine consumption.
- Both verbs are exposed as library functions so kane-cli can
  [mount them in-process](0019-runtime-typescript-node.md).

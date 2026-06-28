---
id: 7
slug: run-lifecycle
title: Run lifecycle — running, finalized, aborted
status: accepted
date: 2026-06-26
proposition: >
  A pack is written while a run is in flight and read after it ends. How do we
  represent that live-vs-sealed state, and what does it imply for authority of
  the data?
options:
  - id: lifecycle-enum
    summary: run.status is running → finalized | aborted, distinct from verdicts; finalize seals the pack.
    chosen: true
  - id: none
    summary: No lifecycle; a pack is always assumed complete.
    chosen: false
  - id: reuse-verdict
    summary: Reuse the verdict enum for run state.
    chosen: false
decision: >
  `run.yaml.status` is a lifecycle: `running → finalized | aborted`. It is NOT a
  verdict. While `running`, totals/index/hashes are not authoritative; `finalize`
  seals them. `aborted` is a run that ended without sealing.
governs:
  - design/schemas/L0/run.schema.json#/properties/status
feature: [run-model]
depends_on: []
supersedes: []
---

## Reasoning

Evidence is written incrementally, so a reader must be able to tell a mid-flight
pack from a sealed one. A dedicated lifecycle makes "live vs sealed" explicit and
keeps it cleanly separate from test [verdicts](0006-verdict-enum.md) — a run can
be `finalized` while containing `failed` tests; the two axes are independent.

The lifecycle has teeth: while `running`, derived data (`totals`, definition
hashes) is not yet authoritative, so the [validator is status-gated](0018-status-gated-validation.md)
and only demands the sealed set once `status: finalized`. `aborted` records that
a run stopped without a clean seal — useful signal, not an error to hide.

## Consequences

- [`finalize`](0017-commands-validate-and-finalize.md) is the operation that
  flips `running → finalized` and seals derived data atomically.
- The run.yaml schema conditionally requires `ended` and `totals` only when
  `status: finalized`.

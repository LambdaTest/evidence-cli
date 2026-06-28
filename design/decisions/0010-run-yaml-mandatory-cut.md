---
id: 10
slug: run-yaml-mandatory-cut
title: run.yaml mandatory cut for L0 v0.1
status: accepted
date: 2026-06-26
proposition: >
  Of all the fields a run.yaml can carry, which are mandatory at L0 v0.1 — the
  "minimal" profile?
options:
  - id: small-identity-core
    summary: MUST = evidence, run_id, status, started, title; ended/totals required once finalized; metrics/environment optional; lineage deferred.
    chosen: true
  - id: id-only
    summary: Only an id is required.
    chosen: false
  - id: everything
    summary: Require the full rich shape.
    chosen: false
decision: >
  run.yaml MUST carry `evidence`, `run_id`, `status`, `started`, `title`.
  `ended` and `totals` are required once `status: finalized`. `totals` is
  DERIVED by finalize. `metrics` and `environment` are optional. `lineage` is
  deferred.
governs:
  - design/schemas/L0/run.schema.json#/required
feature: [run-model]
depends_on: [3, 7]
supersedes: []
---

## Reasoning

L0 is the *minimal* profile: require the smallest core that still makes a pack
useful and identifiable, and let everything else be optional or arrive at a
higher level. Identity and lifecycle are non-negotiable — without
`evidence`/`run_id`/`status`/`started`/`title` you cannot version, name, place,
or time a run, or tell live from sealed.

`ended` and `totals` only exist once a run is sealed, so they are required
[conditionally on `finalized`](0018-status-gated-validation.md), not always —
otherwise a legitimately `running` pack would fail to validate. `totals` is
[derived by finalize](0011-totals-derived-by-finalize.md), never hand-authored.
`metrics` and `environment` are framework-dependent and therefore
[optional](0013-environment-optional.md). `lineage` is
[deferred](0014-lineage-deferred.md) to keep v0.1 minimal.

## Consequences

- The run schema's base `required` is the five-field identity/lifecycle core; an
  `if/then` adds `ended`+`totals` when finalized.
- Unknown top-level keys are permitted (forward-compatibility for higher levels).

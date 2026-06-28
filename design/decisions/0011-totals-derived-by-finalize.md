---
id: 11
slug: totals-derived-by-finalize
title: Totals are derived by finalize, not authored
status: accepted
date: 2026-06-26
proposition: >
  Who is responsible for the run-level totals — does the framework author them,
  or does evidence-cli compute them?
options:
  - id: finalize-derives
    summary: evidence finalize rolls totals up from every result.yaml.
    chosen: true
  - id: framework-authors
    summary: The framework writes totals into run.yaml itself.
    chosen: false
decision: >
  `evidence finalize` computes `run.yaml.totals` by rolling up the verdicts of
  every tests/<id>/result.yaml. Totals are not hand-authored, and are required
  once the run is finalized.
governs:
  - src/schemas/0.1/L0/run.schema.json#/properties/totals
feature: [run-model, finalize]
depends_on: [6, 7]
supersedes: []
---

## Reasoning

Totals authored by hand drift from the per-test truth — a miscount, a forgotten
update, a copy-paste. Making evidence-cli the single computer of totals
guarantees the run-level summary always agrees with the per-test
[verdicts](0006-verdict-enum.md) it summarizes. The per-test `result.yaml` files
are the source; totals are a projection of them.

This is why totals only become authoritative at `finalize`: while a run is
[`running`](0007-run-lifecycle.md), tests are still arriving, so any total would
be provisional. `finalize` seals the projection at the moment the run completes.

## Consequences

- `finalize` reads all result.yaml verdicts and writes the five-bucket totals.
- `validate` on a finalized pack checks that totals match the rolled-up verdicts;
  a mismatch is an error.

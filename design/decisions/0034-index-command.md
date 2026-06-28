---
id: 34
slug: index-command
title: evidence index — autogenerate the human renders
status: accepted
date: 2026-06-28
proposition: >
  The pack layout allows optional, never-parsed human renders (`summary.md`,
  `result.md`). Who produces them? `finalize` does not, and hand-authoring them
  defeats "auto-generated from the load-bearing data."
options:
  - id: index-command
    summary: >
      A third command, `evidence index`, regenerates the optional human renders
      (summary.md / result.md) from the load-bearing data. Pure projection;
      never load-bearing; safe to re-run or delete.
    chosen: true
  - id: fold-into-finalize
    summary: Have `finalize` also write the renders.
    chosen: false
  - id: leave-to-producers
    summary: Say nothing; let each framework write its own renders.
    chosen: false
decision: >
  `evidence index <dir>` autogenerates the optional human renders — the run-level
  `summary.md` and each `tests/<id>/result.md`/`summary.md` — purely from the
  load-bearing `run.yaml` + `result.yaml` data. The output is never parsed, never
  load-bearing, and always reproducible: deleting and re-running `index` changes
  nothing material. It is kept SEPARATE from `finalize` so sealing stays about
  derivation+seal and rendering stays optional.
governs:
  - src/
  - design/contract/03-commands.md
feature: [index]
depends_on: [17, 3]
supersedes: []
---

## Reasoning

[The pack layout](0001-decisions-gate-code.md) promises `summary.md`/`result.md`
as "auto-generated … never parsed," but [stage-one commands](0017-commands-validate-and-finalize.md)
only specified `finalize` (derive+seal) and `validate` (check) — nothing
generated the renders, so the promise had no owner. `evidence index` is that
owner.

Keeping it a distinct verb (not a `finalize` side-effect) matters: `finalize` is
the one irreversible, authority-conferring operation
([it flips the lifecycle and seals](0007-run-lifecycle.md)); rendering is the
opposite — cosmetic, repeatable, throwaway. Conflating them would make sealing
depend on a Markdown renderer and tempt readers to treat a render as evidence.
Separation keeps the [load-bearing set](0015-result-yaml-mandatory-cut.md) and
the human-friendly set cleanly apart: `index` only ever *reads* load-bearing
data and *writes* derived prose.

`index` is purely additive surface, exactly the kind of DX command
[0017 deferred](0017-commands-validate-and-finalize.md) (like `init`) — added now
because the format already references the renders it produces.

## Consequences

- `src/` gains `index` alongside `validate`/`finalize`, exposed as a library
  function for the [in-process mount](0019-runtime-typescript-node.md).
- `index` writes only optional `*.md` renders; it never touches load-bearing
  YAML and never sets lifecycle or totals.
- `03-commands.md` documents three commands; the render files stay optional and
  unparsed in the [pack layout](0003-pack-model-and-manifest-anchor.md).

---
id: 35
slug: finalize-targets-live-directory
title: finalize operates only on the live directory
status: accepted
date: 2026-06-28
proposition: >
  `finalize` derives totals/hashes, flips to `finalized`, and produces the zip.
  Does it accept an already-sealed `.evidence` zip as input, or only the live
  `<name>.evidence/` directory?
options:
  - id: directory-only
    summary: >
      `finalize` accepts ONLY the live `<name>.evidence/` directory and emits the
      sealed `<name>.evidence` zip. It refuses an already-sealed zip. `validate`
      still accepts either form.
    chosen: true
  - id: accept-both
    summary: Let `finalize` accept a zip too (re-finalizing in place).
    chosen: false
decision: >
  `evidence finalize` operates ONLY on the live `<name>.evidence/` directory and
  produces the sealed `<name>.evidence` zip. It will not finalize an already-
  sealed zip (that pack is, by definition, already finalized). `validate` is the
  read-only verb and continues to accept BOTH a directory and a zip; the
  asymmetry is intentional — only `validate` is container-agnostic.
governs:
  - src/
  - design/contract/03-commands.md
feature: [finalize]
depends_on: [17, 3, 7]
supersedes: []
---

## Reasoning

`finalize` mutates: it writes `totals`, `definition.sha256`, `ended`, flips
[`status` to `finalized`](0007-run-lifecycle.md), then seals. Every one of those
is a property of a *live, in-progress* pack — the `<name>.evidence/` directory.
An already-sealed [zip](0003-pack-model-and-manifest-anchor.md) is the *output*
of finalize; feeding it back in has no meaning (it is already finalized) and
would imply mutating a sealed archive in place. So `finalize`'s input domain is
exactly the live directory.

[`validate`](0017-commands-validate-and-finalize.md) is different: it only reads,
and a sealed pack is the most important thing to check, so it must accept the zip
too. Naming the asymmetry — write-verb takes the directory, read-verb takes
either — removes the ambiguity in the original "both commands accept either
form" wording and keeps the [flat-zip layout](0028-zip-internal-layout.md) as a
pure transport/seal artifact that finalize *creates* and never re-consumes.

## Consequences

- `03-commands.md` no longer says both verbs accept either form: `finalize`
  takes the live directory; `validate` takes a directory or a zip.
- `finalize` on a `.evidence` zip is a usage error (exit `2`).
- Re-rendering after seal is the job of [`index`](0034-index-command.md) on the
  directory, not a re-`finalize`.

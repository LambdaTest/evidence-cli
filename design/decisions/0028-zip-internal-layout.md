---
id: 28
slug: zip-internal-layout
title: Sealed-zip internal layout — anchor at the archive root
status: accepted
date: 2026-06-28
proposition: >
  A sealed pack is `<name>.evidence` (a zip). Does the archive wrap a
  `<name>.evidence/` root folder, or sit flat with `run.yaml` at the zip root?
  `validate` must read "the top-level run.yaml" from a zip — where is "top"?
options:
  - id: flat-anchor-at-root
    summary: >
      The zip is flat — `run.yaml` is an entry at the archive root, `tests/…`
      beside it. The archive entries mirror the directory's contents 1:1, with no
      wrapping `<name>.evidence/` folder.
    chosen: true
  - id: wrapped-root-dir
    summary: Zip wraps a single `<name>.evidence/` directory; entries are nested under it.
    chosen: false
  - id: unspecified
    summary: Leave it to producers (status quo).
    chosen: false
decision: >
  The sealed zip is FLAT: `run.yaml` is an entry at the archive root and
  `tests/<id>/…` sit beside it — the archive entries are exactly the *contents*
  of the `<name>.evidence/` directory, with NO wrapping `<name>.evidence/` folder.
  "Top-level run.yaml" therefore means an entry named `run.yaml` at the zip root.
  `validate` reads a directory and a zip identically: the anchor is the root-level
  `run.yaml` in both.
governs:
  - design/contract/01-pack-layout.md
feature: [pack-format]
depends_on: [3]
supersedes: []
---

## Reasoning

[0003](0003-pack-model-and-manifest-anchor.md) defines the
[manifest anchor](0003-pack-model-and-manifest-anchor.md) as "a top-level
`run.yaml`" and says the zip is "the same bytes, just archived." For two
producers to seal interoperable packs, "top-level" inside a zip has to be
pinned — `.epub` keeps its anchor flat at the root, most `.zip`s wrap a folder,
and that ambiguity would split the ecosystem on day one.

We choose **flat**, because it is the literal reading of "the bytes inside are
identical to the directory": the directory's *contents* become the archive's
entries. A reader resolves the anchor the same way for both forms — look for
`run.yaml` at the root — so the [status-gated validator](0018-status-gated-validation.md)
needs no special-casing, and a `definition.path` that is "relative to the test
directory" resolves identically whether the pack is live or sealed.

This also keeps [finalize](0035-finalize-targets-live-directory.md) trivial: it
zips the contents of `<name>.evidence/` into `<name>.evidence` without
re-rooting anything.

## Consequences

- `evidence finalize` writes a flat zip: archive-root `run.yaml`, `tests/…`
  beside it, no `<name>.evidence/` wrapper entry.
- `validate` locates the anchor at the archive root for a zip and at the
  directory root for a directory — one rule, two containers.
- The pack `<name>` lives only in the *file* name, never as an internal path
  segment, consistent with [run_id being the run identity](0010-run-yaml-mandatory-cut.md).

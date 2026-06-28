---
id: 3
slug: pack-model-and-manifest-anchor
title: Pack model and the run.yaml manifest anchor
status: accepted
date: 2026-06-26
proposition: >
  How is an evidence pack physically structured and transported, and what single
  thing identifies a directory or file as a valid pack?
options:
  - id: dir-zip-with-anchor
    summary: A `<name>.evidence/` directory (live) that zips to a `<name>.evidence` file (sealed), like .ipa/.epub; run.yaml at the top is the manifest anchor.
    chosen: true
  - id: single-file-binary
    summary: A bespoke single-file binary container.
    chosen: false
  - id: database
    summary: A SQLite/embedded DB per run.
    chosen: false
decision: >
  A pack is a `<name>.evidence/` directory while being written, and a
  `<name>.evidence` zip once sealed (a plain zip with a known extension, like
  .ipa or .epub). The top-level `run.yaml` is the manifest anchor: its presence
  identifies a valid pack. One pack = one run. `validate` accepts either form.
governs:
  - design/contract
  - design/schemas/L0/run.schema.json
feature: [pack-format, finalize]
depends_on: []
supersedes: []
---

## Reasoning

Zip-with-a-known-extension is a boring, proven container model (`.ipa`, `.jar`,
`.docx`, `.epub`). It gives us a single portable artifact for transport and a
plain directory for live writing — the same bytes, just archived. No new
container format to specify, and every language already has a zip reader.

We need one unambiguous "is this a pack?" check. Rather than a separate
`manifest.json`, the run-level [`run.yaml`](0010-run-yaml-mandatory-cut.md) *is*
the anchor: a directory (or zip) with a top-level `run.yaml` is a pack. This
keeps the format flat — there is exactly one required run-level file, and it is
also the thing that names the run.

Because the contract is defined over the *internal tree*, the zip is pure
transport/sealing. `validate` therefore accepts both a `*.evidence/` directory
and a `.evidence` zip and reads entries the same way.

## Consequences

- The validator must transparently read both a directory and a zip.
- Sealing (producing the zip) is part of [`finalize`](0017-commands-validate-and-finalize.md),
  which is also where the live→sealed [lifecycle](0007-run-lifecycle.md) flips.
- "One pack = one run" keeps `run_id` and the pack identity 1:1.

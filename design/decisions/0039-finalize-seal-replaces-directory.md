---
id: 39
slug: finalize-seal-replaces-directory
title: finalize seals in place — the sealed file replaces the live directory
status: accepted
date: 2026-06-28
proposition: >
  finalize must emit a file named `<name>.evidence` (0028), but the live pack is a
  directory with that exact name; a file and a directory of the same name cannot
  coexist in one parent. 0028/0035 fix the zip's name and internal layout but not
  WHERE the sealed file lands relative to the identically-named directory. What is
  the rule?
options:
  - id: replace-dir
    summary: >
      Build the flat zip in memory, remove the live directory, and write
      `<name>.evidence` (the file) at the path the directory occupied.
    chosen: true
  - id: output-elsewhere
    summary: Keep the directory; write the seal to cwd or an explicit --output, erroring on collision.
    chosen: false
  - id: sibling-distinct-name
    summary: Keep the directory; write the seal beside it under a non-colliding name.
    chosen: false
decision: >
  `finalize` seals IN PLACE: it builds the flat zip of the directory's contents in
  memory, removes the live `<name>.evidence/` directory, and writes the sealed
  `<name>.evidence` FILE at the exact path the directory occupied. The live form
  becomes the sealed form. The bytes are preserved in the seal and the operation
  is reversible (unzipping restores the tree); the complete zip buffer is built
  BEFORE the directory is removed, so a mid-operation failure cannot lose data
  silently.
governs:
  - src/
  - design/contract/03-commands.md
feature: [finalize]
depends_on: [35, 28, 7]
supersedes: []
---

## Reasoning

The contract names the sealed artifact `<name>.evidence` and places the live pack
at `<name>.evidence/` — the same name. A file and a directory cannot share a name
in one parent, so finalize must choose. Writing the seal elsewhere (cwd,
`--output`, or a renamed sibling) keeps the directory but breaks the contract's
promise that the pack's sealed form is exactly `<name>.evidence` at the pack's
location, and forces every caller to juggle two artifacts and two names.

Sealing in place matches the [lifecycle](0007-run-lifecycle.md): the live
directory is the in-flight workspace, and finalize is the one irreversible,
authority-conferring step that turns it into the sealed deliverable. Once sealed,
the directory is redundant — its bytes live in the [flat zip](0028-zip-internal-layout.md) —
so replacing it is the natural outcome, the same shape as compressing a folder.
Because unzipping restores the tree, "destructive" overstates it: nothing is
lost, the pack only changes form.

The one real risk — losing data if the process dies mid-seal — is bounded by
building the complete zip buffer in memory and only THEN removing the directory
and writing the file. The window in which neither the full directory nor the full
file exists is a single `writeFile` after an in-memory buffer is ready.

## Consequences

- `finalize(dir)` returns `{ totals, sealedPath }` where `sealedPath` is the
  original directory path, now a file.
- finalize builds the zip buffer, then `rm -rf`s the directory, then writes the
  file — never deletes before the buffer is ready.
- A second `finalize` on the now-sealed file is a usage error (exit `2`,
  [0035](0035-finalize-targets-live-directory.md)) — it is already finalized.
- `03-commands.md` gains a line stating the seal replaces the live directory.

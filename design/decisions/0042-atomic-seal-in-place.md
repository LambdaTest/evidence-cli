---
id: 42
slug: atomic-seal-in-place
title: finalize seals atomically — crash- and power-safe
status: accepted
date: 2026-07-01
proposition: >
  0039 seals in place by building the zip buffer, removing the live directory,
  then writing the sealed file. It acknowledged a window where "neither the full
  directory nor the full file exists" (a single `writeFile` after the buffer is
  ready). A crash in that window loses the pack entirely; a crash mid-write leaves
  a truncated zip at the canonical path — which also breaks the range-addressable
  read (0041), since a consumer expects a complete central directory there. How is
  the seal made atomic?
options:
  - id: temp-rename-fsync
    summary: >
      Write the zip to a sibling temp, fsync it, rename the live dir aside, rename
      the temp into place, remove the aside dir; best-effort parent-dir fsync for
      power loss. Export sweepIncomplete(parentDir) so the host recovers leftovers.
    chosen: true
  - id: buffer-then-write
    summary: Keep 0039's build-buffer → rm dir → writeFile, accepting the lossy window.
    chosen: false
  - id: write-elsewhere
    summary: Write the zip to a different path and keep the directory (rejected by 0039).
    chosen: false
decision: >
  `finalize` seals ATOMICALLY. After building the flat zip buffer: (1) write it to
  a sibling temp `<name>.evidence.tmp-<rand>` in the SAME parent directory (same
  filesystem, so the later rename is atomic), fsync the temp file, and close it;
  (2) rename the live `<name>.evidence/` directory aside to
  `<name>.evidence.bak-<rand>`; (3) rename the temp onto `<name>.evidence` (now a
  free name); (4) best-effort fsync the parent directory for power-loss durability
  (skipped where a directory fd can't be synced); (5) remove the aside `.bak-`
  directory (non-critical). At every instant a COMPLETE copy exists — the live
  directory through step 2, the sealed file from step 3 — so any crash leaves a
  recoverable state, never absence. evidence-cli also exports
  `sweepIncomplete(parentDir)`: the host calls it at startup to recover leftovers —
  a `.tmp-*` is deleted (a re-`finalize` regenerates it deterministically) and a
  `.bak-*` is restored to the live directory if the sealed file is absent, else
  removed. This AMENDS 0039's buffer-then-write tail; the "seal replaces the
  directory in place" outcome (0039) is unchanged.
governs:
  - src/finalize
  - design/contract/03-commands.md
feature: [finalize]
depends_on: [39, 41, 35]
supersedes: []
---

## Reasoning

0039 chose to seal in place and, to bound the risk, built the whole zip buffer
before touching the directory — but it still ended with `rm(dir)` then
`writeFile(sealedPath)`. Two failure modes survive that: a crash *between* the two
calls leaves the pack in **neither** form (total loss), and a crash *during*
`writeFile` leaves a **truncated** zip at the canonical path. The second is newly
important because [range-addressable reads](0041-range-addressable-packs.md) fetch
the zip's central directory from exactly that path on a blob store — a half-written
seal is not just missing data, it is a *corrupt* pack a reader will try to parse.

The fix is the standard write-temp-then-rename dance, adapted to the one constraint
that makes it non-trivial here: the sealed file must land at the **same path** the
source directory occupies, and you cannot `rename` a file onto a non-empty
directory (POSIX `EISDIR`/`ENOTEMPTY`). So the directory is moved aside first. The
ordering — temp written and fsynced, dir renamed to `.bak`, temp renamed to the
canonical name — guarantees a complete copy is present at every instant: the live
directory right up to the aside-rename, and the finished sealed file from the
install-rename onward. Renames within one filesystem are atomic, which is why the
temp is a *sibling* (a cross-device temp would silently degrade the final rename to
a non-atomic copy).

**Two durability tiers, named explicitly.** Against a process crash or kill, the
rename *ordering* alone is sufficient — no fsync required, because a rename either
happened or did not. Against power loss, the bytes and the directory-entry changes
must also be on disk, so the temp file is fsynced before the renames and the parent
directory is fsynced after. The parent-dir fsync is **best-effort**: syncing a
directory fd is a POSIX-ism (fine on Linux/macOS, unsupported on Windows), so it is
wrapped and never fatal.

**Why recovery lives partly in the host.** evidence-cli's `finalize` is a one-shot
call; there is no long-lived process here to run a startup sweep — the durable
*store* of packs lives in the **embedding host** (the application that runs
evidence-cli), not in the library. So evidence-cli owns the atomic seal and
*exports* `sweepIncomplete(parentDir)`, and the host wires it into its own startup. The sweep is deterministic: after it
runs, every pack in the directory is either a complete sealed file or a live
directory — never a `.tmp`/`.bak` partial. A leftover `.tmp` is always safe to
delete because the seal is a pure function of the (unchanged) directory; a leftover
`.bak` means the interrupt happened before the install-rename, so restoring it
returns the pack to its pre-finalize live state for a clean re-run.

## Consequences

- `src/finalize` replaces the `rm`→`writeFile` tail with: fsynced temp write →
  rename dir aside → rename temp into place → best-effort parent fsync → remove
  aside. Temp/aside names use a `crypto.randomBytes` suffix.
- New exported `sweepIncomplete(parentDir): Promise<{ restored, removed }>`; the
  host calls it at startup. evidence-cli itself runs no daemon/sweep.
- [0039](0039-finalize-seal-replaces-directory.md)'s consequence about the single
  `writeFile` window is superseded by this atomic sequence (note added there).
- `03-commands.md` gains a sentence that the seal is atomic and recoverable.

---
id: 50
slug: verdict-exit-codes-and-sidecar
title: Verdict exit codes and the verdict sidecar
status: proposed
date: 2026-10-21
proposition: >
  `evidence verdict` (0047) has three outcomes — pass, fail, errored — plus the
  usage errors every command has. Which exit codes does it use, given that the
  existing commands use 0 ok / 1 failure / 2 usage (0037)? And where does the
  verdict live: inside the pack it judged, or beside it?
options:
  - id: zero-one-three-sidecar
    summary: >
      0 pass, 1 fail, 2 usage, 3 errored. The verdict is a sidecar file next to
      the pack; the pack is never modified.
    chosen: true
  - id: zero-five-six
    summary: 0 pass, 5 fail, 6 errored (the design site's draft).
    chosen: false
  - id: verdict-inside-pack
    summary: Write the verdict into the pack at seal or merge time.
    chosen: false
decision: >
  Exit codes: `0` every policy passed · `1` at least one policy failed and none
  errored · `3` at least one policy errored · `2` usage or I/O (a bad flag, an
  unreadable or unparseable policy, a policy that does not check clean against
  the pack's catalog, an unreadable pack, a policy id given twice). A pack
  that lacks the catalog a policy `requires` errors that verdict instead (3):
  the pack, not the policy, is at fault. With `--lint`: `0` no error diagnostics, `1` at least one, `2`
  usage. Each verdict document carries its own `exit_code` (0, 1 or 3) so a
  consumer reading the file gets the same answer as the process. THE VERDICT IS
  A SIDECAR: `evidence verdict` writes `<policy-id>.verdict.json` next to the
  pack (or into `-o`) and never writes into the pack; `finalize` and `merge`
  compute no verdicts. Any sealed pack can therefore be judged at any time,
  against any policy, any number of times, and its bytes — and so its sha256,
  the verdict's `pack.sha256` — never change. A consumer that stores verdicts
  sends them alongside the pack and matches them by `pack.sha256` and
  `policy.sha256`.
governs:
  - src/cli.ts
  - design/contract/03-commands.md
feature: [verdict]
depends_on: [37, 47, 48]
supersedes: []
---

## Reasoning

**Why 0/1/3.** `validate` and `merge` already use `0` ok, `1` the thing you
asked about is bad, `2` you called the tool wrong (0037). A failed policy is
"the thing is bad", so it is `1`. `errored` is neither — the pack could not be
judged — and a CI script must be able to tell it from a real failure without
parsing output, so it takes the next free code, `3`. `0/5/6` from the design
site's draft would break the convention the other commands share.

**Why a sidecar.** A verdict inside the pack would change the pack's bytes after
the fact, so the pack's identity would depend on which policies were run, and
a pack could not be judged again later without a new seal. `evidence merge`
also rebuilds `run.yaml` and drops run-level files, so a verdict written at
seal time would not survive a merge anyway. Beside the pack, a verdict is
cheap to add, never invalidates the pack, and names the exact bytes it judged.

## Status

Proposed pending maintainer review of the exit codes; the sidecar placement is
a product ruling.

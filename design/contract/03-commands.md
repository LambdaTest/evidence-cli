---
title: Commands & config
order: 3
profile: L0
---

# Commands & config (L0)

evidence-cli ships four commands, all operating on the pack's internal tree.
`finalize` and `index` take the **live** `<name>.evidence/` directory, `validate`
accepts **either** a directory or a sealed `.evidence` zip, and `merge` reads N
packs (either form) and writes a new live directory.

| Command | Input | Mutates? |
| --- | --- | --- |
| `finalize` | live `<name>.evidence/` directory only | yes — derives + seals |
| `index` | live `<name>.evidence/` directory only | yes — only optional `*.md` renders |
| `validate` | a directory **or** a sealed `.evidence` zip | no — read-only |
| `merge` | N packs (directories or sealed zips) | no — sources read-only; writes a **new** live pack |

## `evidence finalize <dir>`

Seals a live pack. Operates **only** on the `<name>.evidence/` directory — it will
not finalize an already-sealed zip (exit `2`), since that pack is already
finalized. See decision [0035 — finalize targets the live directory](#/decisions).

1. Rolls up `run.yaml.totals` from every `tests/<id>/result.yaml` verdict.
2. Computes and writes each `result.yaml` `definition.sha256` from the file at
   `definition.path`.
3. Sets `run.yaml.status: finalized` and `ended`.
4. Seals the pack to a `<name>.evidence` zip — a **flat** archive whose entries are
   the directory's contents (root-level `run.yaml`, `tests/…` beside it, no
   wrapping folder). See decision [0028 — zip internal layout](#/decisions).
   Already-compressed artifacts (images, video, gzipped logs) are added with the
   zip **STORE** method, not re-deflated — it saves nothing on entropy-coded bytes,
   speeds up sealing, and leaves each artifact a contiguous, directly range-able
   span. The archive is never outer-wrapped or solid-compressed, so the pack stays
   **range-addressable** (the L0 YAML/definition entries may still DEFLATE). See
   decision [0041 — range-addressable packs](#/decisions).

The seal **replaces the live directory in place**: finalize writes the sealed
`<name>.evidence` *file* at the exact path the directory occupied. Unzipping
restores the tree. The replacement is **atomic and recoverable** — finalize writes
a fsynced sibling temp, renames the live directory aside, renames the temp into
place, and removes the aside, so a complete copy exists at every instant and no
crash (or power loss, with a best-effort parent-dir fsync) can lose or truncate
the pack. After an interrupted run the host calls `sweepIncomplete(<parent>)` to
recover any leftover. See decisions [0039 — finalize seals in place](#/decisions)
and [0042 — atomic seal-in-place](#/decisions).

## `evidence index <dir>`

Regenerates the **optional** human renders — the run-level `summary.md` and each
`tests/<id>/result.md` / `summary.md` — purely from the load-bearing `run.yaml` +
`result.yaml` data. The output is never parsed, never load-bearing, and always
reproducible: deleting and re-running `index` changes nothing material. It is kept
separate from `finalize` so sealing stays about derivation + seal. See decision
[0034 — index command](#/decisions).

## `evidence validate <target> --profile L0`

Checks a pack against a profile. Accepts a directory **or** a sealed zip.
Validation is **status-gated**:

| Run status | Checks |
| --- | --- |
| `running` / `aborted` | **Structure-only** — see the structure-only checks below. |
| `finalized` | **Full seal** — the structure-only checks **plus** the full-seal checks below. |

Beyond the JSON-Schema shape, the validator enforces these cross-checks
(decision [0031](#/decisions)) — JSON Schema cannot express cross-file equality,
sibling comparison, or filesystem facts:

**Structure-only (every run status):**
- the manifest anchor (`run.yaml`) and identity fields are present;
- `result.test` equals its `tests/<id>/` directory name;
- each test dir has a `result.yaml` and a declared `definition.path`, **and the
  file at that path exists** (only the *hash* waits for finalize);
- `definition.path` is contained — no `/`-prefix, no `..`, no escape;
- step `ordinal`s are unique and strictly increasing (gaps allowed).

**Full seal (adds, when `finalized`):**
- `ended` and `totals` present, and `ended` ≥ `started`;
- `totals` equals the rolled-up per-test verdicts, **and** `totals.tests` equals
  the sum of the four verdict buckets;
- every `definition.sha256` is present and hash-matches its file.

A test `status` that disagrees with its steps is a **warning**, never a failure —
the [test verdict is authored](#/decisions), so the validator checks, it does not
judge.

Proposed CLI conventions: exit `0` = valid, `1` = invalid, `2` = usage error;
human-readable output by default, `--json` for machine consumption.

See decisions [0017 — Commands](#/decisions),
[0018 — Status-gated validation](#/decisions), and
[0031 — Validator cross-checks](#/decisions).

## Profiles (and how they relate to the `evidence` version)

`L0` is the minimal profile. Higher and orthogonal profiles (L1–L3, browser,
mobile, a11y, security) are **purely additive** — they add assertions and finding
layers and never rewrite the L0 core.

A **profile** is not the same axis as the **`evidence` version**. The version
(`"0.1"`) is the *contract* — the field meanings — and one contract version spans
the whole profile ladder. Adding a profile is additive and never changes the
version; only a **breaking** change to an existing meaning bumps it (a
version-pinned validator then cleanly rejects the newer pack rather than
mis-reading it). See decision [0027 — Evidence version vs profiles](#/decisions).

The active profile resolves as:

```
--profile flag  →  config.defaultProfile  →  built-in default (L0)
```

## Config

evidence-cli reads `~/.testmuai/evidence/config.json` by default (branded under
testmuai, **not** nested under kaneai — evidence-cli is its own entity). Override
with the `EVIDENCE_CONFIG` env var or a `--config` flag. The config holds
`defaultProfile` today and is extensible to multiple named profiles/configs.

```jsonc
// ~/.testmuai/evidence/config.json
{
  "defaultProfile": "L0"
}
```

See decisions [0020 — Profile resolution](#/decisions) and
[0021 — Config location](#/decisions).

## Mounting into kane-cli

evidence-cli is built in TypeScript/Node and exposes `validate`/`finalize` as
library functions, so kane-cli mounts it **in-process** as `kane-cli evidence`
with shared types and no subprocess boundary. See decision
[0019 — Runtime](#/decisions).

## `evidence merge <pack...> --run-id <id> -o <out.evidence>`

Assembles two or more evidence packs (sealed zips or live directories) into
one live pack under a declarative **merge-rules** policy — the policy gates
whole packs and resolves per-test collisions, merge or discard. Merge never
writes a derived artifact: the existing `finalize` remains the sole producer
of totals, hashes, the root failure index, and `ended` (opt in immediately via
`--finalize`, or later, manually, on the assembled output). See decision
[0045 — Merge command & merge rules](#/decisions).

```bash
evidence merge <pack...> --run-id <id> -o <out.evidence> \
    [--rules merge-rules.yaml] [--title <t>] [--finalize]
```

- `<pack...>` — two or more packs; **CLI order is meaningful**: it anchors
  `must: same` reference values, defines `prefer_first`, and tie-breaks
  `prefer_latest`.
- `--run-id` — **mandatory**; a usage error (exit `2`) without it. Merge takes
  no clock reading and generates no random id, so identity is the caller's
  supplied fact — the same testability precedent as `finalize`'s `endedAt`.
- `-o` — output pack path, always a live `<name>.evidence/` directory. Refuses
  to overwrite an existing path.
- `--rules` — the merge-rules YAML (below). Omitted → strict defaults.
- `--title` — the merged `run.yaml` title; default is the first eligible
  pack's title.
- `--finalize` — after assembling, runs the real `finalize` on the output with
  `endedAt = max(source ended)` (fallback `max(source started)`) — the
  truthful end of the logical run. Without the flag, a later manual
  `finalize` stamps seal time instead (a documented difference).

### The merge-rules file

A flat rule list `{file, key, must, on_violation}` beside two fixed knob
blocks. Every rule's `file` also fixes its **scope**: `run.yaml` rules are
compared **across all eligible packs** and gate whole packs; `result.yaml`
rules are compared **between two colliding tests** and resolve collisions.
`key` is a dot-path into the parsed YAML.

```yaml
# merge-rules.yaml
packs:
  require_status: finalized     # finalized | running | any
  require_valid: L0             # L0 | L1 | off
  on_ineligible: abort          # abort | skip
tests:
  on_collision: error           # error | prefer_first | prefer_latest | discard
  identity:                     # OPTIONAL (0046); absent → 0045 behaviour, unchanged
    keys:                       # dot-paths into result.yaml — the caller's vocabulary
      - external_id.commit_id
      - external_id.test_id
    on_same: nest               # nest | prefer_latest | prefer_first | error
    on_different: split         # split | error
rules:
  - file: run.yaml              # scope: compared ACROSS all eligible packs
    key: environment.producer.name
    must: same                  # same | different
    on_violation: abort         # abort | skip   (pack-scoped actions)
  - file: run.yaml
    key: run_id
    must: different
    on_violation: skip
  - file: result.yaml           # scope: compared BETWEEN two colliding tests
    key: environment.model
    must: same
    on_violation: discard       # error | prefer_first | prefer_latest | discard
```

Pack-scoped rules only allow pack actions (`abort`/`skip`); collision rules
only allow collision actions (`error`/`prefer_first`/`prefer_latest`/
`discard`) — enforced by the schema itself. `src/schemas/merge-rules.schema.json`
validates the rules file; it lives **beside**, not under, the versioned `0.1/`
tree (tool input, not pack contract), compiled through the same AJV path used
elsewhere. A rules file that fails to parse or conform is a **usage error
(exit `2`)** before any pack is opened.

Omitting `--rules` uses the strict defaults — nothing dropped silently:

```yaml
packs: { require_status: finalized, require_valid: L0, on_ineligible: abort }
tests: { on_collision: error }
rules: []
```

### Pack gates — in order, cheap → expensive

1. **Readable manifest** — `run.yaml` missing or unparseable → ineligible.
2. **Version gate** — `evidence != "0.1"` → ineligible; never merge across
   contract versions.
3. **`require_status`** (default `finalized`) — `running`/`aborted` →
   ineligible.
4. **`require_valid`** (default `L0`; `L1` or `off` settable) — runs the
   existing `validate`; any error diagnostic → ineligible.
5. **Generic `run.yaml` rules** — `{file: run.yaml, key, must, on_violation}`.

Ineligibility resolves per `packs.on_ineligible`: **`skip`** (drop the pack,
record why in the report, continue) or **`abort`** (the whole merge fails,
exit `1`). A rule's own `on_violation` overrides the global for that rule.
Zero eligible packs is always an error; **one** eligible pack still merges (a
valid single-source pack — CI scripts stay unconditional).

Packs are processed one at a time, in CLI order: a pack must pass **all**
gates and rules to join the eligible set, and rules compare only against
**previously eligible** packs. A pack that anchors a `same` value but then
fails a later rule never becomes eligible, and its anchor is discarded — the
next fully-surviving pack anchors instead.

### `must` semantics

- **`same`** — the *first eligible pack* anchors the reference value; each
  later pack that differs violates. Deterministic; no majority voting.
- **`different`** — the first occurrence of a value keeps; a later pack
  repeating it violates — e.g. `{file: run.yaml, key: run_id, must: different,
  on_violation: skip}` dedupes a double-submitted shard automatically.
- **Absent keys** — absent == absent counts as `same`; absent vs. present
  counts as `different`.
- Values compare by canonical deep equality (objects/arrays included).

### Test-level collisions

Each eligible pack's `tests/<id>` ids are claimed in CLI order; the first
claimant is the **incumbent**, a later pack with the same id is a
**collision**, resolved pairwise (incumbent vs. challenger) by the first
collision rule that fires (in file order), else the `tests.on_collision`
default.

| Action | Meaning |
| --- | --- |
| `error` | abort the whole merge (exit `1`) — the strict default |
| `prefer_first` | incumbent wins (CLI order) |
| `prefer_latest` | the copy from the pack with the later `run.yaml` `ended` wins (fallback `started`; tie → CLI order) |
| `discard` | drop the test **entirely** — both copies; the id is **tombstoned** so a third pack's copy cannot resurrect it |

3+-way collisions resolve pairwise in CLI order: the winner of (1 vs 2) faces
pack 3's copy, and so on; any `discard` verdict tombstones the id for good.
The winner's entire `tests/<id>/` directory travels **whole** — definition,
`result.yaml`, `logs/`, `steps/` (screenshots and failure records), video —
the loser's tree is dropped completely, with no artifact-level mixing between
copies. Folding collisions into `attempts[]` (retry semantics) is
deliberately out of scope — see decision
[0033 — attempts is a per-attempt outcome list](#/decisions).

### Identity grouping (optional, 0046)

When `tests.identity` is configured, a collision that violates **no**
`result.yaml` rule is resolved by **grouping** instead of by picking a winner —
guard rules still abort first, so a `must: same` + `error` rule can never be
downgraded into a split. Two copies have the same identity when **every** key
in `keys` compares equal under the canonical deep equality above (absent ==
absent counts as same). The challenger is matched against each existing group
of that id **in allocation order**; the first match absorbs it (`on_same`), and
no match allocates a new folder (`on_different`).

| Action | Meaning |
| --- | --- |
| `on_same: nest` | keep **every** copy: the latest run takes the canonical `tests/<id>/`, each superseded run is archived whole beneath it as `1/`, `2/` … oldest first (by `ended`, fallback `started`; ties → CLI order) |
| `on_different: split` | the copy lands in a **new sibling** `tests/<id>-1/`, `-2/` … the first group keeps the unsuffixed name |

Suffixes are allocated against the union of every eligible pack's test ids, so
a split never steals a name some pack legitimately owns — if `<id>-1` exists as
a real test, the split takes `<id>-2`. A split folder's `result.yaml` `test`
field is **rewritten** to equal its directory (the L0 cross-check requires the
equality); a nested copy keeps its original id, since nothing validates it and
the archive stays truthful. `discard` tombstones the **base id** — every group
of it goes, split siblings included.

Nested copies are **inert**: totals walk only top-level `tests/*`, the failure
index reads only `tests/<id>/steps/`, and the L1 step checks enumerate only
`<test>/steps/`. An archive therefore changes no count and fails no check. Note
that `nest` retains artifacts `prefer_latest` would discard, so a merged pack
grows with the number of runs kept.

### `run.yaml` — per-key disposition

| Key | Across the N inputs | Value in merged `run.yaml` |
| --- | --- | --- |
| `evidence` | must be same — hard version gate, not policy | `"0.1"` |
| `run_id` | no constraint by default | **`--run-id`** (mandatory) |
| `status` | gated by `require_status`, never compared | `running` (live until finalize) |
| `title` | no constraint | first eligible pack's title; `--title` overrides |
| `started` | no constraint — execution fact | `min(started)` across eligible packs |
| `ended` | no constraint — execution fact | **not written by merge**; `--finalize` seals with `max(source ended)` (fallback `max(source started)`) |
| `totals` | ignored — never compared, never summed | absent; `finalize` re-derives from the merged union |
| `metrics` | no constraint — free-form semantics unknowable | **namespaced by flattening** into the metric name: `<i>-<run_id>/<name>` (1-based index over eligible packs in CLI order; skipped packs consume no ordinal), each original typed object intact |
| `environment` | no built-in constraint; rules pick sub-keys | **common subset** stays run-level; divergent keys **pushed down** per test (per-test value wins where already present) |
| `merged_from` *(new, additive)* | — | list of source `run_id`s, in CLI order |

`coverage/` from each eligible source nests under `coverage/<i>-<run_id>/`
(the same label used for metrics). The root `failure.yaml` index is
**deliberately not copied** — the live merged pack has no root index (valid:
presence is only required at `finalized`, decision
[0044 — Failure records](#/decisions)); `finalize` regenerates it from the
merged tree, exactly as it does for any other live pack.

### Exit codes

`0` merged (policy-sanctioned skips/discards included) · `1` abort/error
(rule abort, collision `error`, zero eligible packs) · `2` usage (missing
`--run-id`, unreadable/invalid rules file, output path exists).

### `MergeReport`

`src/merge/` exposes `merge(inputs, opts): Promise<MergeReport>`; the CLI
prints it via the existing reporter conventions.

```yaml
packs:
  eligible: [shard-a, shard-b]              # run_ids, CLI order
  skipped:  [{ run_id: shard-a2, rule: "run.yaml run_id must different", reason: duplicate of shard-a }]
tests:
  merged: 214                               # TOP-LEVEL test folders (= groups)
  collisions:
    - { test: checkout, winner: shard-b, rule: tests.on_collision=prefer_latest }
    # 0046 outcomes carry the shape they took and where the copy landed:
    - { test: login, winner: shard-c, rule: tests.identity.on_same=nest, action: nest, folder: login }
    - { test: login, winner: shard-d, rule: tests.identity.on_different=split, action: split, folder: login-1 }
  discarded: [flaky-login]
output: { path: merged.evidence, run_id: nightly-2026-07-08, finalized: true }
```

`action` and `folder` appear only on 0046's shape-changing outcomes; the other
three fields are unconditional, so existing `--json` consumers keep parsing
unchanged. `winner` is the canonical member for `nest` and the absorbed
challenger for `split`.

Policy-sanctioned skips/discards exit `0` — the report carries the story. The
pack itself stays clean: `merged_from` is the only in-pack trace of the
merge.

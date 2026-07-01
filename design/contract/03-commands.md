---
title: Commands & config
order: 3
profile: L0
---

# Commands & config (L0)

Stage one ships three commands, all operating on the pack's internal tree. Only
`validate` is container-agnostic: `finalize` and `index` take the **live**
`<name>.evidence/` directory, while `validate` accepts **either** a directory or a
sealed `.evidence` zip.

| Command | Input | Mutates? |
| --- | --- | --- |
| `finalize` | live `<name>.evidence/` directory only | yes — derives + seals |
| `index` | live `<name>.evidence/` directory only | yes — only optional `*.md` renders |
| `validate` | a directory **or** a sealed `.evidence` zip | no — read-only |

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

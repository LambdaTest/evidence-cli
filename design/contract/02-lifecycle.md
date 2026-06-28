---
title: Lifecycle & verdicts
order: 2
---

# Lifecycle & verdicts (L0)

The format has **two independent axes**. Keeping them separate is deliberate:
one describes the *run's progress*, the other describes *test outcomes*.

## Run lifecycle — `run.yaml.status`

```
running  ──finalize──▶  finalized
   │
   └────────────────▶  aborted
```

- **`running`** — the run is in flight. `totals`, `ended`, and definition hashes
  are **not yet authoritative**.
- **`finalized`** — the pack is sealed. `finalize` has rolled up `totals`,
  written each `definition.sha256`, set `ended`, and produced the `.evidence`
  zip. This is the only authoritative state.
- **`aborted`** — the run ended without sealing.

This lifecycle is **not** a verdict. A run can be `finalized` and still contain
`failed` tests.

## Test verdict — `result.yaml.status` (and each step's `status`)

The same four values are used at **test level and step level**:

| Verdict | Meaning |
| --- | --- |
| `passed` | The oracle was satisfied. |
| `failed` | The oracle was evaluated and **the product was wrong** (a real defect). |
| `broken` | The oracle **could not be evaluated** — environment / infrastructure / test fault. |
| `skipped` | Not executed. |

The `failed` vs `broken` distinction is the heart of the model: it separates
"the product is wrong" from "we couldn't tell." See decision
[0006 — Verdict enum](#/decisions).

## What `finalize` derives

`finalize` is the operation that flips `running → finalized` and **derives**:

- `run.yaml.totals` — the five-bucket roll-up over every `result.yaml` verdict.
- each `result.yaml` `definition.sha256` — the content hash of the opaque
  definition file declared at `definition.path`.

Producers never hand-author these. See decisions
[0011 — Totals derived by finalize](#/decisions) and
[0005 — Definition located by path](#/decisions).

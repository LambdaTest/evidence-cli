# Conformance fixtures

Example packs that pin the L0 contract. They are the **input corpus** for the
`validate` test suite: the data-driven harness at `src/conformance/` runs every
pack here through `validate`, in **both** its directory and sealed-zip forms, and
checks each against a sidecar expectation (see "Conformance harness & sidecars"
below).

## Layout

Fixtures are organized **version-first**, mirroring the schema tree
(`src/schemas/<version>/<profile>/`, decision 0038), so new contract versions,
profiles, and cases slot in without disturbing existing ones:

```
fixtures/
  0.1/                         # contract version
    L0/                        # profile
      valid/      <case>.evidence/ + <case>.expected.yaml   # validate passes
      invalid/    <case>.evidence/ + <case>.expected.yaml   # validate fails
      finalized/  <case>.evidence/                          # finalize scenario inputs
```

`valid/` and `invalid/` are the **validate** corpus (every pack carries a sidecar).
`finalized/` holds live `running` packs used as **finalize** inputs (no sidecar);
they are exercised by `src/finalize/index.test.ts`.

## `0.1/L0/valid/`

### `smoke.evidence/` — a finalized pack that fully conforms
- `run.yaml`: `status: finalized`, with `ended` and `totals` present.
- `totals: { tests: 2, passed: 1, failed: 1, broken: 0, skipped: 0 }` — **agrees**
  with the two per-test verdicts (`checkout` passed, `login` failed).
- Each `tests/<id>/` has an opaque `test.md` definition plus a `result.yaml` whose
  `definition.sha256` is the **real** hash of that `test.md`.
- Shows optional fields in use: `metrics` (`{value, type}`), `environment`, per-step
  `kind`/`defect`/`expected`/`actual`/`check`, `tags`, `requirements`.

## `0.1/L0/invalid/`

Each pack isolates a single violation.

### `totals-mismatch.evidence/`
`status: finalized` and structurally fine, but `totals` claims `passed: 1, failed: 0`
while the one test's verdict is `failed`. On a finalized pack, totals **must** agree
with the rolled-up verdicts → invalid. (Decisions 0011, 0018.)

### `missing-status.evidence/`
`status: running` (so absent `ended`/`totals` is fine), but
`tests/checkout/result.yaml` omits the required `status` field. A missing required
field is invalid at any run status. (Decision 0015.)

### `path-escape.evidence/`
`status: running` and otherwise fine, but `tests/checkout/result.yaml` declares
`definition.path: ../shared/test.md`, which escapes the test directory.
`definition.path` must be a contained relative path at any run status → invalid.
(Decisions 0029, 0031.)

### `ordinal-collision.evidence/`
`status: running` and otherwise fine, but the two steps in
`tests/checkout/result.yaml` both claim `ordinal: 1`. Step ordinals must be unique
and strictly increasing in array order (gaps are allowed) → invalid. (Decisions
0030, 0031.)

## Regenerating definition hashes

`definition.sha256` values are real. If you edit a `test.md`, recompute:

```bash
printf 'sha256:%s\n' "$(shasum -a 256 path/to/test.md | cut -d' ' -f1)"
```

## Conformance harness & sidecars

Every pack under `0.1/L0/valid/` and `0.1/L0/invalid/` is paired with an
`expected.yaml` **sidecar** that lives *beside* the pack (outside the `.evidence/`
directory, so `validate`/`finalize` never observe it). The harness
(`src/conformance/`) runs each pack through `validate` in **both** forms —
directory and sealed zip — and asserts the declared outcome, plus that the two
forms agree (decision 0028).

```
0.1/L0/invalid/
  ordinal-collision.evidence/        # the pack
  ordinal-collision.expected.yaml    # its expectation
```

Sidecar schema (snake_case, per decision 0036):

```yaml
valid: false                  # required — expected report.valid
errors: [ordinal.collision]   # error codes that MUST appear (subset / "contains")
warnings: []                  # optional — warning codes that must appear
not_errors: [schema.invalid]  # optional — codes that must NOT appear
description: human note         # optional — ignored by the harness
```

- `errors`/`warnings` are **subset** checks (robust to extra diagnostics and to
  message-wording changes); `not_errors` is a **must-not-contain** check.
- An `invalid` fixture **must** declare at least one `errors` code — the harness
  fails otherwise.
- A pack with **no sidecar** is a hard harness failure: no silent skips.

**Adding a conformance test** is mechanical: drop a `<name>.evidence/` pack and a
`<name>.expected.yaml` beside it; the harness picks it up automatically and runs
it in both forms.

### Current corpus

| Pack | `valid` | Expected codes |
| --- | --- | --- |
| `0.1/L0/valid/smoke` | `true` | — |
| `0.1/L0/invalid/ordinal-collision` | `false` | `ordinal.collision` |
| `0.1/L0/invalid/totals-mismatch` | `false` | `totals.mismatch` |
| `0.1/L0/invalid/missing-status` | `false` | `schema.invalid` |
| `0.1/L0/invalid/path-escape` | `false` | `definition.path_escape` |
| `0.1/L0/invalid/hash-mismatch` | `false` | `definition.hash_mismatch` |
| `0.1/L0/invalid/ended-before-started` | `false` | `ended.before_started` |
| `0.1/L0/invalid/version-0.2` | `false` | `version.unsupported` (and **no** `schema.invalid`) |

`0.1/L0/finalized/running.evidence/` is not part of the validate corpus — it is an
*input* to `finalize` (a live `running` pack), exercised by
`src/finalize/index.test.ts`.

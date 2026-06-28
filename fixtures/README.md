# Conformance fixtures

Example packs that pin the L0 contract. They are illustrative now and become the
input corpus for the `validate` test suite once `src/` lands.

## `valid-L0/`

### `smoke.evidence/` — a finalized pack that fully conforms
- `run.yaml`: `status: finalized`, with `ended` and `totals` present.
- `totals: { tests: 2, passed: 1, failed: 1, broken: 0, skipped: 0 }` — **agrees**
  with the two per-test verdicts (`checkout` passed, `login` failed).
- Each `tests/<id>/` has an opaque `test.md` definition plus a `result.yaml` whose
  `definition.sha256` is the **real** hash of that `test.md`.
- Shows optional fields in use: `metrics` (`{value, type}`), `environment`, per-step
  `kind`/`defect`/`expected`/`actual`/`check`, `tags`, `requirements`.

## `invalid-L0/`

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

---
id: 31
slug: validator-cross-checks
title: Validator cross-checks beyond JSON Schema
status: accepted
date: 2026-06-28
proposition: >
  Several L0 rules cannot be expressed in JSON Schema (cross-file equality,
  sibling comparisons, filesystem facts). They are scattered through prose. What
  is the explicit, testable list the validator must enforce, and at which status?
options:
  - id: enumerate-cross-checks
    summary: >
      Name every non-schema check as a first-class part of the contract, each
      tagged structure-only (any status) or full-seal (finalized).
    chosen: true
  - id: leave-in-prose
    summary: Keep these implied across the various decisions.
    chosen: false
decision: >
  Beyond JSON-Schema shape, `validate` enforces these cross-checks.
  STRUCTURE-ONLY (every run status): (a) `result.test` equals its `tests/<id>/`
  directory name; (b) each test dir has a `result.yaml` and a declared
  `definition.path`, and the file at that path EXISTS; (c) `definition.path` is
  contained (no escape); (d) step `ordinal`s are unique and strictly increasing.
  FULL-SEAL (status `finalized`, adds): (e) `ended` ≥ `started`; (f) `totals`
  equals the rolled-up per-test verdicts AND `totals.tests` equals the sum of the
  four verdict buckets; (g) every `definition.sha256` is present and hash-matches
  its file. The step-vs-test status disagreement remains a WARNING, never a
  failure.
governs:
  - src/
  - design/contract/03-commands.md
feature: [validate]
depends_on: [18, 11, 5]
supersedes: []
---

## Reasoning

[Status-gated validation](0018-status-gated-validation.md) said full-seal packs
get "consistency checks … that pure JSON Schema cannot express," but the actual
list lived implicitly across [totals](0011-totals-derived-by-finalize.md),
[definition path](0005-definition-located-by-path.md),
[path safety](0029-definition-path-safety.md), and
[ordinal](0030-step-ordinal-semantics.md). A conformance format must state these
as plainly as the schema, or every implementer guesses and the validator drifts
from the docs — the failure [0024](0024-schemas-single-source-of-truth.md) exists
to prevent. This decision is the single, testable enumeration.

Two deliberate calls:

- **Definition-file existence is structure-only, not just finalized.** The
  definition is the framework's own artifact, authored when the test is defined —
  it should be on disk even mid-run. Only the *hash* waits for
  [finalize](0035-finalize-targets-live-directory.md). So a `running` pack that
  points at a missing definition file is already wrong, and we catch it early.
- **`totals.tests` = sum of the four buckets** is stated explicitly. It falls out
  of "totals equals the rolled-up verdicts," but naming it makes the invariant
  testable on its own and documents what `tests` counts (every result, skipped
  included).

Step-vs-test disagreement stays advisory because the
[test status is authored](0016-test-status-authored.md), not derived — the
validator is a checker, not a judge.

## Consequences

- `03-commands.md` lists these checks in its status-gated table.
- The `fixtures/` corpus should exercise each: dir-name mismatch, missing
  definition file, escaping path, ordinal collision, `ended` < `started`,
  totals mismatch, hash mismatch.
- `src/` implements them on top of the schema pass.

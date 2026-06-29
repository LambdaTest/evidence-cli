---
id: 40
slug: l1-profile-evidence-artifacts
title: L1 profile — the evidence-artifact layer
status: accepted
date: 2026-06-29
proposition: >
  L0 records the structured outcome of a run but deliberately leaves the captured
  proof — logs, screenshots, coverage, video — out (0015). What is the next
  profile, L1, and what does it add on top of the full L0 core? Is L1 a set of
  newly-required L0 fields, or a new layer of artifacts? And how is it validated
  given a profile must be additive (0027)?
options:
  - id: artifact-layer
    summary: >
      L1 is an additive layer of captured-evidence ARTIFACTS — per-test logs/ and
      steps/ screenshots and a global coverage/ (mandatory), optional video —
      declared/named by convention, opaque to evidence-cli, validated by
      filesystem cross-checks plus two small declaration schemas. No new
      run.yaml/result.yaml fields.
    chosen: true
  - id: promote-l0-fields
    summary: >
      L1 makes L0's optional forensic FIELDS required (expected/actual/defect,
      duration_ms, environment.producer, step kind/check).
    chosen: false
  - id: standalone-l1-schemas
    summary: >
      Author complete standalone L1 schemas (copy L0 + additions); the validator
      picks one schema set per profile.
    chosen: false
decision: >
  L1 is the EVIDENCE-ARTIFACT layer. On top of the full L0 core (every L0 rule
  still holds, same `evidence: "0.1"`), an L1 pack MUST carry: per test a `logs/`
  directory with a `logs/meta.yaml` declaring at least one `{ name, file, format }`
  (format ∈ a closed `{ndjson, har, log}`) whose `file` exists and is contained;
  per test a `steps/` directory whose subfolders are named `<ordinal>-<id>`,
  match a `result.yaml` step, and contain a `screenshot.<ext>`; and one GLOBAL
  `coverage/` directory (existence only — its internals are open). Per-test
  `video` (an inline `video.<ext>` or a `video.yaml` with `url`) is OPTIONAL; a
  per-test `issues/` directory is reserved and unvalidated. Artifacts are OPAQUE
  (existence/naming/declared-format checked, never parsed) except the small
  declarations `logs/meta.yaml` and `video.yaml`. Validation is ADDITIVE and
  LAYERED — a profile resolves to a chain (`L1 → [L0, L1]`) and `validate
  --profile L1` runs every L0 check then the L1 additions. L1 checks are NOT
  status-gated; instead the report carries the pack's current `status` so a host
  that validates mid-run can interpret missing-artifact findings in context.
  `finalize` is UNCHANGED — it already seals every artifact in the directory.
governs:
  - design/contract/04-L1.md
  - src/schemas/0.1/L1
  - src/
feature: [l1-profile]
depends_on: [27, 4, 29, 18, 38, 15]
supersedes: []
---

## Reasoning

[L0's mandatory cut](0015-result-yaml-mandatory-cut.md) recorded *that* something
happened in a parseable shape and explicitly deferred "the rich forensics that
explain *why*" to higher levels. The most valuable next layer is not more
*fields* but the **captured artifacts themselves** — the logs, screenshots, and
coverage a reader or auditor actually opens. So L1 is conceived as an
**artifact layer**, not a re-typing of L0's optional fields (the
`promote-l0-fields` option). Those forensic fields remain available at L0 and can
still be tightened by a later profile if wanted; they are a different axis from
"is the proof attached."

**Why opaque, declared, contained.** evidence-cli already treats the
[definition](0004-definition-required-but-opaque.md) as an opaque artifact it
references and hashes but never parses, and it
[forbids path escape](0029-definition-path-safety.md). L1 reuses that exact
stance for every artifact: a screenshot, a log, a video is checked for
*existence, naming, and declared format* — never parsed. This keeps L1
framework-agnostic (any image/video/log format) and keeps the validator small.
Only the two tiny declarations that evidence-cli must understand —
`logs/meta.yaml` (what logs exist and in what format) and `video.yaml` (where the
external video is) — are parsed, each against its own L1 schema under
[`src/schemas/0.1/L1/`](0038-schemas-canonical-home-in-src.md).

**Why additive + layered.** [0027](0027-evidence-version-and-profiles.md) makes a
profile purely additive on a single contract version. Modelling a profile as a
**chain of layers** (`L1 = [L0, L1]`) is the literal implementation of that: L1
adds checks, never rewrites L0, and L2/L3 slot in as further links. This beats
`standalone-l1-schemas`, which would duplicate the L0 schema bodies and invite
exactly the drift [0024](0024-schemas-single-source-of-truth.md) exists to
prevent. L1 adds **no fields** to `run.yaml`/`result.yaml`; it is a sibling-tree
layer validated by filesystem cross-checks plus the two declaration schemas.

**Why not status-gated, and why the report carries `status`.** L0 gates some
checks on `finalized` because totals/hashes literally do not exist until
[finalize](0018-status-gated-validation.md). L1 artifacts are produced during the
run, and *when* to demand them is a host concern, not the validator's: the
kane-cli mount decides when to run L1 validation. So L1 checks run whenever
invoked, and `validate` instead **reports the pack's current `status`** — a
caller validating a `running` pack sees both the L1 findings and that the pack is
still in flight, and interprets accordingly. This keeps the validator a checker,
not a lifecycle manager.

**Why `finalize` is untouched.** [finalize](0035-finalize-targets-live-directory.md)
already zips the *contents* of the live directory; logs/steps/coverage/video ride
along with no change. finalize derives L0 totals/hashes and seals — it does not
validate, and it gains no L1 responsibility.

## Consequences

- New contract page [`design/contract/04-L1.md`](04-L1.md) and L1 schemas
  `src/schemas/0.1/L1/{logs-meta,video}.schema.json`.
- `src/` gains a profile chain (`PROFILES`), an L1 validation layer, and
  container primitives (`exists`/`isDir`/`listDir`/`readText`) that read a
  directory and a flat zip identically (extending [0028](0028-zip-internal-layout.md)
  to artifact directories). `ValidationReport` gains a `status` field.
- New L1 diagnostic codes (`l1.logs.*`, `l1.steps.*`, `l1.coverage.missing`,
  `l1.video.invalid`); the conformance corpus gains `fixtures/0.1/L1/{valid,invalid}/`
  and the harness infers the profile from the fixture path.
- Deferred, additively: `issues/`, `coverage/` internals, artifact hashing, and
  L2/L3.

---
id: 27
slug: evidence-version-and-profiles
title: Evidence version vs profiles — two independent axes
status: accepted
date: 2026-06-28
proposition: >
  A pack declares `evidence: "0.1"` AND is validated against a profile (L0 now;
  L1–L3 later). Are the format version and the profile the same axis? What does
  a new profile mean for the version, and when does the version itself change?
options:
  - id: version-spans-profiles
    summary: >
      `evidence` is the CONTRACT version and spans the whole profile ladder
      (L0–L3). Adding a profile is additive and never touches the version; only
      a BREAKING change to an existing meaning bumps the version.
    chosen: true
  - id: version-equals-profile
    summary: Treat L0/L1/L2/L3 as the version (bump the version when a profile is added).
    chosen: false
  - id: forward-tolerant-version
    summary: Make the validator accept any `evidence` value ≥ its own (loose const).
    chosen: false
decision: >
  `evidence` is the CONTRACT version, not a profile. One contract version spans
  every profile (L0–L3): a profile only ADDS required assertions on top of what
  the version already guarantees, so shipping L1 does NOT change `evidence`.
  The version changes ONLY on a BREAKING change to an existing meaning. Because a
  validator is pinned to a contract version, `evidence` stays a `const` per
  schema version: a 0.1 validator MUST reject a 0.2 pack rather than silently
  mis-read it. Additive = new profile (same version); breaking = version bump,
  and older packs are never retro-invalidated.
governs:
  - src/schemas/0.1/L0/run.schema.json#/properties/evidence
  - src/schemas/0.1/L0/result.schema.json#/properties/evidence
  - design/contract
feature: [run-model, result-model]
depends_on: [10, 20]
supersedes: []
---

## Reasoning

Two things were being conflated: the *format version* (`evidence: "0.1"`) and the
*validation profile* (`L0`). The README even wrote "L0 (evidence `0.1`)" as if
they were one. They are orthogonal:

- **Profile** answers *how much do we require of this pack* — L0 is the minimal
  core, and [higher/orthogonal profiles are purely additive](0020-profile-resolution.md).
  A profile never rewrites the core; it only adds assertions.
- **Version** answers *which contract are these field meanings drawn from*. The
  whole format is built to [scale by adding](0010-run-yaml-mandatory-cut.md), so
  the version moves rarely — only when an existing guarantee changes incompatibly.

### Additive vs breaking — the rule that protects the version number

The version is only trustworthy if the boundary is explicit:

| Change | Lever |
| --- | --- |
| Add an optional field | Additive — same version |
| Add a new profile (L1–L3, browser, …) | Additive — same version |
| Add a field required *only* at a higher profile | Additive — same version |
| Rename / remove an L0 field | **Breaking — bump version** |
| Change an L0 field's meaning or an enum value's semantics | **Breaking — bump version** |
| Tighten an existing L0 requirement | **Breaking — bump version** |

### Why `const`, not a loose range

A version-pinned validator is the point. If a 0.1 validator silently accepted a
0.2 pack, it would validate field meanings it does not actually understand — the
exact "spec loses trust" failure [0024](0024-schemas-single-source-of-truth.md)
guards against. Hard rejection on the version field is the safety mechanism.
Forward-tolerance lives where it belongs and already exists: unknown *keys* are
tolerated, and *profiles* are additive — neither requires loosening the version.
Old packs keep declaring `0.1` and a 0.1 validator keeps validating them forever.

## Consequences

- `evidence` remains `const` in each schema version; its description states it is
  the contract version spanning profiles, bumped only on a breaking change.
- Introducing L1 is a new profile and a set of additive assertions — it does not
  touch `evidence` or any L0 schema.
- A future `0.2` ships as a sibling schema set; `0.1` packs and the `0.1`
  validator are unaffected.

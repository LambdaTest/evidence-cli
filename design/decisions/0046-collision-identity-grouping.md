---
id: 46
slug: collision-identity-grouping
title: Collision identity grouping — nest supersessions, split distinct tests
status: accepted
date: 2026-07-20
proposition: >
  0045 resolves a test-id collision to exactly ONE surviving copy and lists
  "cross-environment matrix identity (keeping both copies of a colliding test
  disambiguated by environment)" as deferred. Two copies of `tests/<id>/` can
  mean two different things: the SAME logical test run twice, or two GENUINELY
  DIFFERENT tests that happen to share a derived id. How does a caller declare
  which is which, and what shape does the merged pack take in each case?
options:
  - id: identity-block
    summary: >
      An optional `tests.identity: {keys, on_same, on_different}` block names
      the key paths that constitute test identity and the outcome for each
      case. Collisions become GROUPS keyed by identity: same identity nests
      superseded copies under the canonical folder, different identity splits
      into a suffixed sibling folder. Absent the block, 0045's behaviour is
      unchanged.
    chosen: true
  - id: split-action-in-rules
    summary: >
      No new block — add a `split` action to the existing result.yaml
      `on_violation` enum and a `nest` action to `tests.on_collision`, so
      identity is whatever set of rules happens to carry `split`.
    chosen: false
  - id: caller-side-pregrouping
    summary: >
      Leave merge alone. The caller inspects packs, computes identity groups
      itself, pre-renames colliding test directories in staging copies, and
      merges a set that no longer collides.
    chosen: false
decision: >
  `tests.identity` is an OPTIONAL block in merge-rules.yaml:
  `{keys: [<dot-path>...], on_same: <action>, on_different: <action>}`. When
  it is ABSENT, merge behaves EXACTLY as 0045 specifies — this decision is
  purely additive and changes no default. `keys` is a non-empty array of
  dot-paths into the parsed `result.yaml`, resolved by the same `getKey`
  walker and compared by the same canonical `deepEqual` as 0045's generic
  rules, inheriting its absent-key semantics VERBATIM: absent == absent
  counts as SAME, absent-vs-present counts as DIFFERENT. Two copies have the
  SAME IDENTITY when every listed key compares equal. `keys` are the
  CALLER'S FACT — evidence-cli never interprets them and ships no default
  set, so a producer's identity vocabulary (a test-manager id, a commit sha, a
  browser name) stays in the producer's policy file and the tool stays
  vendor-neutral.
  RESOLUTION ORDER on a collision is fixed and does NOT change 0045's first
  stage: the `result.yaml` rules run FIRST, in file order, pairwise against
  the FIRST GROUP's representative, and the first violated rule applies its
  `on_violation` exactly as today; only when no rule is violated does the
  identity block run. A guard rule (`must: same` + `on_violation: error`)
  therefore still ABORTS ahead of any grouping and can never be quietly
  downgraded into a split folder — the property that lets a caller keep
  tenancy guards and identity keys in one file without their precedence
  being ambiguous. With no identity block and no rule violated, the default
  `tests.on_collision` applies, unchanged. A GROUP'S REPRESENTATIVE is its
  FIRST MEMBER IN CLI ORDER — the group's original claimant — so stage one
  preserves 0045's incumbent semantics exactly, and stage two's comparison is
  well-defined because every member of a group shares an identity by
  construction. `discard` TOMBSTONES THE BASE ID, not a folder: every group of
  that base id is dropped, INCLUDING split siblings already allocated, and the
  id stays tombstoned against later packs — a split folder is not a way around
  a tombstone.
  The union walk generalises from ONE INCUMBENT per test id to an ORDERED
  LIST OF GROUPS per test id. A group is `{baseId, folder, members[]}`:
  `baseId` is the original `tests/<id>` name, `folder` is the output
  directory name, `members` are the eligible packs contributing a copy, in
  CLI order. A challenger is compared against each existing group of its
  baseId IN ALLOCATION ORDER; the FIRST group whose representative has the
  same identity ABSORBS it (`on_same`); if no group matches, `on_different`
  applies. This is what makes 3+-way collisions well-defined — pack C's copy
  is tested against the `<id>` group AND the `<id>-1` group before a third
  folder is minted — and it is why identity is a DECLARED SET of keys rather
  than an emergent property of the rule list: the walk needs the set as an
  up-front fact. The single-member group where `folder == baseId` is
  precisely 0045's behaviour, so there is ONE code path, not two.
  `on_same` takes `nest | prefer_latest | prefer_first | error`;
  `on_different` takes `split | error`. `nest` KEEPS EVERY MEMBER: members
  sort ASCENDING by the source pack's `run.yaml` `ended` (fallback
  `started`, ties broken by CLI order), the LAST — the latest run — occupies
  the canonical `tests/<folder>/` exactly as an uncontested test does, and
  each earlier member is written WHOLE to `tests/<folder>/<n>/`, 1-based,
  `1/` being the OLDEST. WHOLE-TREE ATOMICITY (0045) is preserved per
  member: a member's `result.yaml`, definition, `logs/`, `steps/` and video
  travel together and nothing is mixed between copies. `split` allocates a
  NEW SIBLING folder: the first group of a baseId keeps the UNSUFFIXED name,
  later groups take `<baseId>-1`, `<baseId>-2`, and so on. Suffixes are
  allocated against a RESERVATION SET — the union of every eligible pack's
  test ids, computed once before the walk (the eligible set is already fixed
  by then) — and a candidate name already in that set or already allocated
  is SKIPPED, so a split never steals a name some pack legitimately owns.
  A split folder's `result.yaml` `test` field is REWRITTEN to equal its new
  directory name, because 0031's validator cross-check requires that
  equality; the rewrite goes through the comment-preserving
  `parseDoc`/`setIn` path 0045 already uses for the environment push-down, so
  the definition file is never touched and hash checks stay green. A NESTED
  member's `result.yaml` `test` field is NOT rewritten: nothing validates a
  nested copy, and preserving the original id keeps the archive truthful
  about what it was. 0043's environment push-down runs on EVERY copy
  written, canonical and nested alike, each against ITS OWN source pack's
  environment — the divergent keys are what let an archived copy be read
  standalone, which is the entire reason for keeping it.
  NESTED COPIES ARE INERT to every derived artifact, by construction rather
  than by special-casing: finalize's totals walk only top-level `tests/*`
  directories, its failure index reads only `tests/<id>/steps/`, and the L1
  step checks enumerate only `<test>/steps/`. A numbered subdirectory is
  therefore invisible to totals, to the root failure index, to
  `listTestIds`, and to validation — it rides along as an archive and
  changes no count. `MergeReport.tests.merged` counts TOP-LEVEL test
  folders, which is now the number of GROUPS. `MergeReport.tests.collisions`
  gains two OPTIONAL fields, `action` (`nest` | `split`) and `folder` (the
  output directory), leaving `{test, winner, rule}` intact so existing
  `--json` consumers keep parsing; `winner` carries the canonical member's
  run_id for `nest` and the absorbed challenger's for `split`. Merge remains
  DETERMINISTIC — every ordering derives from pack metadata and CLI order,
  no clock and no randomness are read.
---

## Reasoning

**Why an identity block rather than a `split` action in the rule list.** The
rule list is a sequence of INDEPENDENT pairwise predicates: each one fires on
its own and the first violation decides. That shape is exactly right for
"which copy wins", where the answer is a choice between two things already in
hand. It is wrong for grouping, because grouping needs to ask a question the
rule list cannot express — *does this challenger belong to group 0, group 1,
or neither?* — and answering it requires knowing the WHOLE SET of keys that
constitute identity before any comparison happens. Scraping that set back out
of a flat list as "every rule whose action is `split`" would make identity an
emergent property of an unrelated ordering: adding a tenancy guard would
silently redefine what "the same test" means. Declaring the set once, in a
block that exists to declare it, keeps the fact where a reader looks for it.

**Why the new actions are not enum values on `on_collision`.** `error`,
`prefer_first`, `prefer_latest` and `discard` all answer one question — which
of two copies survives — and none of them changes the SHAPE of the merged
pack; the output is always `tests/<id>/`, one directory per colliding id.
`nest` and `split` answer a different question: what topology does the output
take. Keeping them in the identity block, where the condition that selects
them also lives, states that difference in the format instead of hiding it
behind a wider enum whose members no longer share a meaning.

**Why the caller cannot do this outside merge.** Merge DISCARDS the losing
tree, so by the time a caller could post-process, the superseded artifacts are
gone. The only caller-side alternative is to pre-group: read every pack, apply
identity comparison, rename directories in staging copies, then merge a
non-colliding set. That reimplements pack reading, dot-path resolution and
canonical equality in a second place, and it puts the rename — including the
0031 `test`-field rewrite — outside the tool that owns the contract those
rules come from.

**Why the latest run keeps the canonical slot.** The alternative — nesting
every member uniformly under `tests/<id>/1..n/` — is more symmetric, but it
would move `result.yaml` out of `tests/<id>/result.yaml` and break the L0
layout for every consumer, requiring contract changes to validate, finalize
and every reader. Keeping the latest run exactly where an uncontested test
sits means a consumer that does not care about history reads a nested pack
identically to a flat one, and the archive is strictly additive.

## Consequences

- `src/merge/collide.ts` is reshaped: `claims` becomes
  `Map<baseId, TestGroup[]>`, the exported `UnionEntry` is replaced by
  `TestGroup {baseId, folder, members[]}`, and the reservation set is computed
  from the eligible packs before the walk.
- `src/merge/assemble.ts` takes `groups: TestGroup[]` in place of
  `union: UnionEntry[]`, sorts each group's members chronologically, writes the
  canonical and nested copies, and rewrites `test` on split folders only.
- `src/merge/rules.ts` gains the `IdentityPolicy` type; `DEFAULT_RULES` is
  UNCHANGED (`tests.identity` stays undefined), so the strict defaults of 0045
  still hold when `--rules` is omitted.
- `src/schemas/merge-rules.schema.json` gains `tests.identity` with
  `additionalProperties: false`, `keys` as a `minItems: 1` array of non-empty
  strings, and the two action enums.
- `contract.ts`'s `MergeReport.tests.collisions` gains optional `action` and
  `folder`; `src/report/reporter.ts` prints the nest/split outcome.
- `design/contract/03-commands.md` gains the identity block in the `merge`
  section — the rules-file shape, the resolution order, and the two output
  layouts.
- A `nest` merge produces a LARGER pack than the same merge under
  `prefer_latest`: artifacts that are discarded today are retained. This is
  the intent of the feature, not a regression, but it is a real change to
  output size for callers who opt in.
- Deferred, additively: identity keys addressing `run.yaml` (today's `keys`
  are result-scoped, matching where per-test identity lives); a `fold_attempts`
  action folding nested members into 0033's `attempts[]` (still deferred from
  0045, and now expressible as a third `on_same` action); an
  auto-derived identity from the environment block, which 0045 sketched as
  "cross-environment matrix identity" — the explicit `keys` list subsumes it
  for now, since a caller can name the environment paths directly.

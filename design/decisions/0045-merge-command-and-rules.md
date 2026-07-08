---
id: 45
slug: merge-command-and-rules
title: Merge command — policy-driven pack merging (merge-rules)
status: accepted
date: 2026-07-08
proposition: >
  Sharded runs produce N packs that must become one. What does `evidence merge`
  do, what does a passed merge-rule govern (merge or discard at pack and test
  level), and how does the result relate to finalize's derived artifacts?
options:
  - id: assemble-then-finalize
    summary: >
      merge ASSEMBLES a live pack under a declarative rules file (pack gates +
      collision policy + generic {file, key, must} predicates); the existing
      finalize derives totals/hashes/failure-index/ended and seals (--finalize
      convenience). Mandatory --run-id; merged_from lineage.
    chosen: true
  - id: merge-seals-directly
    summary: merge produces a sealed zip itself, re-implementing finalize's derivation.
    chosen: false
  - id: finalize-merge-mode
    summary: finalize --merge a b c — no new command, overloads 0035's contract.
    chosen: false
decision: >
  `evidence merge <pack...> --run-id <id> -o <out> [--rules f] [--title t]
  [--finalize]` ASSEMBLES a new live pack from two or more inputs under a
  declarative merge-rules policy; merge never writes a derived artifact — the
  existing `finalize` remains the SOLE producer of totals, hashes, the root
  failure index, and `ended`, whether invoked immediately via the `--finalize`
  convenience flag or later, manually, on the resulting live directory.
  `<pack...>` order is meaningful: it anchors `must: same` reference values,
  defines `prefer_first`, and tie-breaks `prefer_latest`. `--run-id` is
  MANDATORY — its absence is a usage error (exit 2); merge is fully
  deterministic (no clock, no randomness), so identity is the caller's
  supplied fact, mirroring the `finalize` `endedAt` testability precedent.
  `-o` refuses an existing path. `--rules` names the merge-rules YAML;
  omitted, STRICT DEFAULTS apply (below). `--title` overrides the default
  merged title (the first eligible pack's). `--finalize` runs the real
  `finalize` on the assembled output with `endedAt = max(source ended)`
  (fallback `max(source started)` when no source carries `ended`) — the
  truthful end of the logical run; without the flag, a later manual
  `finalize` stamps its own seal time instead (a documented difference). The
  merge-rules file is a flat rule list `{file, key, must, on_violation}`
  beside two fixed knob blocks: `packs: {require_status, require_valid,
  on_ineligible}` and `tests: {on_collision}`. A rule's `file` fixes its
  SCOPE — `run.yaml` rules gate whole packs (evaluated during gating, in file
  order); `result.yaml` rules resolve test collisions (evaluated pairwise
  between two colliding tests, in file order; the first VIOLATED rule
  applies its `on_violation`, else the default `tests.on_collision` applies).
  `key` is a dot-path into the parsed YAML. Pack-scoped rules only permit
  pack actions (`abort`/`skip`); collision rules only permit collision
  actions (`error`/`prefer_first`/`prefer_latest`/`discard`) — enforced by
  the schema itself (`if file == run.yaml then …`).
  `src/schemas/merge-rules.schema.json` lives BESIDE, not under, the
  versioned `0.1/` tree — it is tool input, not pack contract — compiled
  through the same AJV path. A
  rules file that fails to parse or conform is a USAGE ERROR (exit 2) before
  any pack is opened. Pack gates run cheap-to-expensive, in order: readable
  `run.yaml`; the hard version gate (`evidence != "0.1"` → ineligible, never
  merge across contract versions); `require_status` (default `finalized` — a
  live directory is normally `running`/`aborted` so is ineligible unless
  relaxed); `require_valid` (default `L0`; `L1`/`off` settable — runs the
  existing `validate`, any error diagnostic → ineligible); then the generic
  `run.yaml` rules. Ineligibility resolves per `packs.on_ineligible` —
  `skip` (drop the pack, record why in the report, continue) or `abort` (the
  whole merge fails, exit 1) — and a rule's own `on_violation` overrides the
  global for that rule. Zero eligible packs is always an error; exactly ONE
  eligible pack still merges (a valid single-source pack, so CI scripts stay
  unconditional). `must` semantics are pinned: `same` — the FIRST ELIGIBLE
  PACK anchors the reference value, and each later pack that differs
  violates (deterministic; no majority vote); `different` — the FIRST
  OCCURRENCE of a value KEEPS, and a later pack repeating it violates (so
  `{file: run.yaml, key: run_id, must: different, on_violation: skip}`
  dedupes a double-submitted shard automatically); absent keys — absent ==
  absent counts as `same`, absent-vs-present counts as `different`;
  comparison is canonical deep equality (objects/arrays included).
  SEQUENTIAL ELIGIBILITY pins the chicken-and-egg: packs are processed one
  at a time in CLI order, a pack must pass all gates and rules to join the
  eligible set, and rules compare only against PREVIOUSLY ELIGIBLE packs — a
  pack that anchors a `same` value but then fails a later rule never becomes
  eligible, and its anchor is discarded; the next fully-surviving pack
  anchors instead. When `--rules` is omitted, STRICT DEFAULTS apply —
  nothing dropped silently: `packs: {require_status: finalized,
  require_valid: L0, on_ineligible: abort}`, `tests: {on_collision: error}`,
  `rules: []`. Test-level collisions resolve by a UNION WALK: in CLI order,
  each eligible pack's `tests/<id>` ids are claimed; the first claimant is
  the INCUMBENT, a later pack with the same id is a COLLISION, resolved
  PAIRWISE (incumbent vs. challenger) by the firing rule or the
  `tests.on_collision` default. Four actions: `error` — abort the whole
  merge (exit 1), the strict default; `prefer_first` — the incumbent (CLI
  order) wins; `prefer_latest` — the copy from the pack with the later
  `run.yaml` `ended` wins (fallback `started`; tie → CLI order); `discard` —
  drop the test ENTIRELY, both copies, and TOMBSTONE the id so a third
  pack's copy cannot resurrect it. 3+-WAY collisions resolve pairwise in CLI
  order — the winner of (1 vs 2) faces pack 3's copy, and so on — and any
  `discard` verdict tombstones the id for good. WHOLE-TREE ATOMICITY: the
  winner's entire `tests/<id>/` directory travels intact — definition,
  `result.yaml`, `logs/`, `steps/` (screenshots and failure records), video
  — and the loser's tree is dropped completely; there is no artifact-level
  mixing between copies. The merged `run.yaml` is synthesized per key:
  `evidence` stays `"0.1"` (the hard version gate, not policy); `run_id` is
  the mandatory `--run-id`; `status` is `running` (live until finalize);
  `title` is the first eligible pack's title unless `--title` overrides;
  `started` is `min(started)` across eligible packs; `ended` is NOT WRITTEN
  by merge — `--finalize` seals it with `max(source ended)` (fallback
  `max(source started)`); `totals` is absent — never compared, never summed
  (a sum would be falsified by collisions/discards) — finalize re-derives
  it from the merged union; `metrics` are NAMESPACED BY FLATTENING into the
  metric name (`<i>-<run_id>/<name>`, each original typed `{value, type}`
  object intact, since literal nesting under `metrics:` would violate
  0012's shape) — the `<i>` is a 1-based index over ELIGIBLE packs in CLI
  order (skipped packs consume no ordinal), and the same `<i>-<run_id>`
  label nests `coverage/<i>-<run_id>/` per source; `environment` keeps only
  the COMMON SUBSET across every eligible pack at run level (deep equality
  per top-level path) and PUSHES DOWN each divergent key into the affected
  tests' `result.yaml` `environment` blocks (per 0043's lossless merge
  design) — kept as-is where a test already carries its own value (per-test
  wins) — via the comment-preserving `parseDoc`/`setIn` path, so the
  definition file is never touched and hash checks stay green; `merged_from`
  (new, additive) is the list of source `run_id`s in CLI order — the small,
  additive slice of 0014's deferred lineage. The root `failure.yaml` index
  is DELIBERATELY NOT COPIED by merge — the live merged pack simply has no
  root index, which is valid because 0044 only requires its presence at
  `finalized`. `finalize` on a merged pack REGENERATES every derived
  artifact from the merged tree exactly as it always has: the failure index
  is rebuilt from the merged union's `steps/*/failure.yaml` (discarded/loser
  tests contribute no rows; winners' rows have correct paths because whole
  trees traveled intact, so 0044's completeness/dangling/row-path
  guarantees hold by construction); `totals` is re-derived by counting
  merged tests (losers/discards naturally excluded); `definition.sha256` is
  re-hashed per test (a no-op re-derivation, since definitions travel
  byte-identical); `ended` is set by `--finalize`'s `max(source ended)`
  (fallback `max(source started)`), or stamped at seal time by a later
  manual `finalize`. The assembled pack validates clean at L0/L1 under
  `status: running` (no index or totals demanded) and, after finalize, at
  `finalized` with the regenerated index — both are testable assertions.
  Exit codes: `0` merged (policy-sanctioned skips/discards included) · `1`
  abort/error (a rule's `abort`, collision `error`, zero eligible packs) ·
  `2` usage (missing `--run-id`, unreadable/invalid rules file, an existing
  `-o` path). `src/merge/` exposes `merge(inputs, opts): Promise<MergeReport>`
  — `{ packs: {eligible, skipped: [{run_id, rule, reason}]}, tests: {merged,
  collisions: [{test, winner, rule}], discarded}, output: {path, run_id,
  finalized} }` — printed by the CLI via the existing reporter conventions;
  the pack itself stays clean, `merged_from` its only in-pack trace of the
  merge.
governs:
  - design/contract/03-commands.md
  - src/schemas/merge-rules.schema.json
  - src/
feature: [merge]
depends_on: [43, 44, 14, 35, 42, 33, 12, 18, 36]
supersedes: []
---

## Reasoning

**Why assemble, not seal or overload finalize.** Every derived artifact —
totals, `definition.sha256`, the root failure index, `ended` — must keep
exactly ONE producer, or two code paths could each derive it differently and
drift. `finalize` already owns derivation and the
[atomic seal](0042-atomic-seal-in-place.md) on a
[live directory](0035-finalize-targets-live-directory.md); a
`merge-seals-directly` design would have to re-implement that whole pipeline
as a second producer, purely to save one command invocation. Overloading
[`finalize`'s existing contract](0017-commands-validate-and-finalize.md) with
a `--merge` mode (`finalize-merge-mode`) is worse: it conflates two different
operations — combining trees under a policy, and deriving/sealing a single
tree — behind one verb, and would force finalize to understand pack-gating
and collision policy it has no other reason to know about. Keeping merge a
pure ASSEMBLER — it writes `run.yaml`, copies winning test trees, pushes
environment down — and letting `--finalize` be a thin, opt-in convenience
call into the unchanged `finalize` keeps the one-producer-per-artifact
invariant intact and lets `finalize`'s existing atomicity, hashing, and
index-generation apply unmodified to a merged tree exactly as it does to any
other live pack.

**Why 0043 had to land first.** [0043](0043-environment-at-result-level.md)
added an optional per-test `environment` precisely to unblock this merge:
without it, combining N single-environment packs into one `run.yaml` with one
`environment` slot would be lossy — divergent per-source environments would
have to be discarded or synthesized. With result-level `environment`
available, merge can keep the common subset at run level and push every
divergent key down onto the tests that actually ran under it, so "what did
`checkout` run on?" stays answerable on the merged pack with nothing thrown
away.

**Why 0044's guarantees hold for free.** The
[failure-record index](0044-failure-records.md) is truthful by construction
on any freshly finalized pack because finalize is its only producer, and
merge changes nothing about that: because collision resolution moves WHOLE
test trees (never individual files), a winner's `steps/*/failure.yaml` and
its folder-anchored `<ordinal>-<id>` naming arrive byte-identical, so
finalize's regenerated index on a merged pack satisfies completeness,
dangling-pointer, and row/path agreement exactly as it would on an unmerged
pack — no special-casing needed in the failure-index checks for merged
input.

**Why caller-supplied identity, not a generated one.** Mandatory `--run-id`
mirrors the precedent set by
[`finalize`'s testable `endedAt`](0042-atomic-seal-in-place.md) parameter:
merge takes no wall-clock reading and generates no random id, so its output
is a pure function of its declared inputs — reproducible in tests and
predictable in CI, where the caller (a pipeline) already has a natural
identity (the pipeline run, a nightly date) that is truer than anything
merge could invent.

**Why the rules file is a flat list beside two knob blocks, not one big
schema.** The three fixed knobs (`require_status`, `require_valid`,
`on_ineligible`, `on_collision`) cover the common cases compactly and need
no per-rule ceremony; the generic `{file, key, must, on_violation}` shape
handles the long tail (a specific run-level key must agree, a specific
collision key decides the winner) without the format having to anticipate
every field a producer might want to compare. Scoping each rule by its
`file` — `run.yaml` gates packs, `result.yaml` resolves collisions — keeps
the action enum small (pack actions and collision actions never mix) while
keeping the *nuance* (which key, which direction) in the rule rather than
growing the action vocabulary.

## Consequences

- New `src/merge/` module exposing `merge(inputs, opts): Promise<MergeReport>`
  and the CLI `evidence merge` command.
- New `src/schemas/merge-rules.schema.json`, living BESIDE (not under) the
  versioned `0.1/` tree — tool input, not pack contract — compiled through
  the existing AJV path ([0024](0024-schemas-single-source-of-truth.md)).
- The run schema gains an optional, additive `merged_from` (array of
  non-empty strings) — no version bump, no L0 pack invalidated
  ([0027](0027-evidence-version-and-profiles.md)).
- `PackContainer` (`src/pack/container.ts`) gains a pack-root-relative
  `readFileBytes` primitive alongside the existing test-relative
  `readBytes`/pack-root `readText`, so merge can copy whole-tree binary
  artifacts (screenshots, video) verbatim without new per-artifact
  knowledge.
- `design/contract/03-commands.md` gains the `## merge` section (command
  surface, rules file, gate order, collision table, run.yaml disposition
  table, exit codes, `MergeReport` shape).
- `design/features.yaml` gains the `merge` feature.
- Deferred, additively: the `fold_attempts` collision action (folding into
  [0033](0033-attempts-and-flaky.md)'s `attempts[]` — retry semantics, not
  shard semantics); cross-environment matrix identity (keeping both copies
  of a colliding test disambiguated by environment); per-metric merge
  arithmetic (sum/max/avg — merge never guesses
  [0012](0012-typed-free-form-metrics.md)'s free-form semantics); `must`
  predicates beyond `same`/`different` (`equals`, `exists`, regex); remote
  inputs (the container interface permits it later; v1 is local paths only).

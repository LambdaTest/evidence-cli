---
id: 37
slug: implementation-stack
title: Implementation stack & architecture (L0 validate + finalize)
status: accepted
date: 2026-06-28
proposition: >
  Building `src/` for L0 introduces concrete choices the prior, contract-level
  decisions do not fix: which JSON-Schema engine, YAML library, zip library, and
  CLI framework; how TTY vs non-TTY and `--json` output are structured; and how
  the validator enforces the pinned `evidence` contract version. What single
  stack and architecture do we commit to, and at what governance weight?
options:
  - id: umbrella-stack
    summary: >
      One record fixing the whole stack — Ajv(2020-12)+ajv-formats, eemeli `yaml`
      (Document API, round-trip), `adm-zip`, Commander, a `Reporter` seam for
      TTY/non-TTY/`--json` — plus the version gate, the pack container, and the
      module boundaries.
    chosen: true
  - id: per-choice-records
    summary: A separate decision record per library / architecture choice.
    chosen: false
  - id: no-record
    summary: Treat all of it as free implementation detail needing no decision.
    chosen: false
decision: >
  `src/` is built on: Ajv (draft 2020-12) + ajv-formats for the schema pass;
  eemeli `yaml` via its Document API so `finalize` round-trips producer
  formatting/comments and only rewrites derived fields; `adm-zip` for the flat
  seal and for reading a sealed zip (entries are read in memory, never extracted
  to disk); Commander for the CLI (`bin: evidence`, exit `0` valid / `1` invalid
  / `2` usage). Output flows through a `Reporter` seam with a TTY-aware
  `HumanReporter` and a `JsonReporter`, selected by `process.stdout.isTTY` and
  `--json` and honoring `NO_COLOR`. A pack/container abstraction
  (`DirectoryContainer` + `ZipContainer`) gives `validate` ONE read path over a
  directory or a flat zip. A named `CONTRACT_VERSION = "0.1"` plus an up-front
  version gate enforce the pinned contract version (implementing 0027): a pack
  whose `evidence` differs is rejected with a dedicated diagnostic and the rest of
  validation is skipped — reject rather than mis-read. This pass ships `validate`
  and `finalize`; `index` (0034) is deferred. The whole stack lands as ONE record
  to honor "no code without a decision" without per-library ceremony.
governs:
  - src/
feature: [runtime, validate, finalize]
depends_on: [19, 17, 18, 31, 27]
supersedes: []
---

## Reasoning

The contract is fully decided; what remained was the mechanical "how." Rather
than a record per library — which would bury the real architecture under
boilerplate — or no record at all — which would violate
[0001](0001-decisions-gate-code.md) the moment `src/` gains a dependency — one
umbrella record names the stack and the few architectural seams that matter, and
defers the buildable detail to the implementation spec.

### The picks

- **Ajv (draft 2020-12) + ajv-formats.** The [schemas](0024-schemas-single-source-of-truth.md)
  use 2020-12 and the `if/then` conditional that
  [status-gated validation](0018-status-gated-validation.md) leans on; Ajv
  executes both directly, and `ajv-formats` supplies the `date-time` check the
  `started`/`ended` fields declare. The schema pass is then a thin wrapper over a
  standard engine, not a hand-rolled validator.
- **eemeli `yaml`, Document API.** `finalize` rewrites only derived fields
  (`totals`, `status`, `ended`, `definition.sha256`). The round-trip Document API
  preserves producer formatting, key order, and comments, so a finalized file is
  a minimal, reviewable diff over what the framework authored — the behavior
  chosen during design. A plain parse/re-emit would reflow producer files
  needlessly.
- **`adm-zip`.** The seal is a [flat zip](0028-zip-internal-layout.md) of the
  directory's contents; `adm-zip` writes that with the least code and reads a
  sealed pack's entries synchronously. We read entries **in memory** and never
  extract to disk, and `definition.path` is independently
  [contained](0029-definition-path-safety.md), so zip-slip is not in play.
- **Commander.** It matches the sibling `test-harness` CLI, keeping the v16
  toolchain consistent, and maps cleanly to the proposed `0/1/2` exit convention.
- **`Reporter` seam.** [0017](0017-commands-validate-and-finalize.md) calls for
  "human output by default, `--json` for machine consumption." A single seam with
  a TTY-aware `HumanReporter` (color + `✓/✗/⚠` on a TTY, plain deterministic
  ASCII off it, `NO_COLOR` honored) and a `JsonReporter` (the exact object the
  library returns) keeps every command output-agnostic and makes the
  TTY/non-TTY/`--json` matrix one decision in one place.

### The seams that matter

- **Pack container.** [0028](0028-zip-internal-layout.md) promises "one rule, two
  containers": the anchor is the root-level `run.yaml` in both a directory and a
  flat zip. `DirectoryContainer` and `ZipContainer` behind one read interface make
  that literal — `validate` has no directory-vs-zip branching past construction.
  `finalize` uses only the directory path and refuses a zip
  ([0035](0035-finalize-targets-live-directory.md)).
- **Version gate.** [0027](0027-evidence-version-and-profiles.md) decides the
  validator is *pinned*: a 0.1 validator must reject a 0.2 pack rather than
  mis-read it. The schema `const "0.1"` is the backstop, but on its own it emits a
  cryptic "must equal constant" error. So a named `CONTRACT_VERSION` and an
  explicit gate run first: a present-but-mismatched `evidence` yields a dedicated
  `version.unsupported` diagnostic and validation halts (no point checking field
  meanings drawn from a contract we do not implement). A *missing* `evidence` is a
  plain required-field error — malformed, not a version mismatch.

### Scope

`validate` and `finalize` are the load-bearing verbs
([0017](0017-commands-validate-and-finalize.md)); the fixtures corpus already
exercises `validate`. [`index`](0034-index-command.md) renders are cosmetic and
their template is unspecified, so it is deferred to a later pass rather than
guessed at now.

## Consequences

- `package.json` gains runtime deps `ajv`, `ajv-formats`, `yaml`, `adm-zip`,
  `commander`, and a tiny color lib (`picocolors`); dev deps `typescript`,
  `vitest`, and the `@types/*` needed.
- `src/` is laid out as in the implementation spec: `pack/`, `schema/`,
  `validate/`, `finalize/`, `config.ts`, `yaml.ts`, `report/`, `cli.ts`,
  `contract.ts`, `index.ts` (the library exports kane-cli mounts in-process per
  [0019](0019-runtime-typescript-node.md)).
- The [fixtures](0031-validator-cross-checks.md) corpus drives the `validate`
  tests; `finalize` gets new fixtures (a `running` pack to seal, a hash-mismatch,
  an `ended < started`).
- `index`, color flags beyond `NO_COLOR`, and module-format alignment with
  kane-cli are out of scope here and tracked for later.

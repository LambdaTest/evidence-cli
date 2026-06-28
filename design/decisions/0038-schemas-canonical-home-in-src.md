---
id: 38
slug: schemas-canonical-home-in-src
title: Schemas' canonical home is src/schemas/<version>/<profile>/
status: accepted
date: 2026-06-28
proposition: >
  0024 made the L0 schemas the single source of truth and placed them under
  `design/schemas/L0/`; 0025 put all schemas inside the `design/` spec tree. The
  validator must consume them with no second copy, and 0027 makes `evidence` a
  version axis that spans the profile ladder. Where do the schemas physically
  live, and how is that directory organized?
options:
  - id: src-version-profile
    summary: >
      Move the schemas to `src/schemas/<version>/<profile>/` (e.g.
      `src/schemas/0.1/L0/`); the validator imports them directly and `design/`
      (viewer + contract) references that location.
    chosen: true
  - id: keep-in-design-copy
    summary: Leave them under `design/schemas/L0/`; a build step copies them into the package.
    chosen: false
  - id: src-flat-profile-only
    summary: Move to `src/schemas/L0/` with no version segment.
    chosen: false
decision: >
  The schemas' canonical home is `src/schemas/<version>/<profile>/` —
  `src/schemas/0.1/L0/run.schema.json` and `result.schema.json` today. The
  validator imports them directly (zero copy), so they remain the SINGLE SOURCE
  OF TRUTH (0024) now owned by the code; `design/web` and the contract pages
  reference this location instead of holding their own copy. The tree is
  VERSION-FIRST because `evidence` spans the profile ladder (0027): one `0.1/`
  directory holds L0…L3, and a future breaking `0.2/` is a SIBLING tree that
  leaves `0.1/` untouched. Each schema `$id` gains the version segment
  (`…/schemas/0.1/L0/run.schema.json`) so two versions never collide in the
  engine's registry. This AMENDS 0024 (the schemas' location) and 0025 (schemas
  now live outside `design/`); the single-source-of-truth principle and the rest
  of the repo structure are unchanged.
governs:
  - src/schemas
  - design/web
  - design/contract
feature: [decision-system, runtime]
depends_on: [24, 25, 27]
supersedes: []
---

## Reasoning

[0024](0024-schemas-single-source-of-truth.md)'s goal is that exactly ONE
artifact is read by both the validator and the viewer — that is what kills doc
drift. Nothing about that goal requires the artifact to sit under `design/`.
Putting it where the validator `import`s it with no copy is the strongest
possible form of "single source": the tool compiles the very bytes the viewer
renders. The build-step copy was rejected for the opposite reason — it
reintroduces a generated second file, the exact thing 0024 set out to remove.

The tree is **version-first** because that is the structural expression of
[0027](0027-evidence-version-and-profiles.md): the `evidence` version spans the
whole profile ladder, so a version *contains* profiles, never the reverse. A
profile is never independently versioned, so `0.1/L0`, `0.1/L1`, … all sit under
one version directory, and 0027's "a future 0.2 ships as a sibling schema set"
becomes a literal sibling `0.2/` tree. Carrying the version in each `$id` means a
registry that ever holds both 0.1 and 0.2 schemas (e.g. during a migration
window) keeps them distinct rather than clobbering one with the other.

This is an **amendment**, not a reversal. [0025](0025-repo-structure.md) keeps
`design/` as the parent for decisions, contract, and the viewer; only the
schemas move out, precisely because they are *consumed by code*, not merely
rendered — the one sibling whose natural owner is `src/`. 0024's principle stands
verbatim; only the path it points at changes.

## Consequences

- Files move: `design/schemas/L0/run.schema.json` → `src/schemas/0.1/L0/run.schema.json`
  (and `result.schema.json`); each `$id` gains the `0.1` segment.
- A tiny `src/schemas/registry.ts` statically imports the JSON and exposes
  `getSchemas(version, profile)`, so the loader stays version/profile-parameterized
  yet fully bundleable and type-checked.
- `design/web`'s schema-load path and the `design/contract`/README path references
  are updated to the new location.
- [0024](0024-schemas-single-source-of-truth.md)'s `governs` pointer and
  [0025](0025-repo-structure.md)'s structure diagram are updated, each with an
  "Amended by 0038" note, when the move lands.

---
id: 25
slug: repo-structure
title: Repo structure — design/ is the living-spec parent
status: accepted
date: 2026-06-26
proposition: >
  How is the repo laid out so the living spec is cohesive and rendered, and code
  is clearly downstream of it?
options:
  - id: design-parent
    summary: design/ is the parent over decisions, contract, schemas, web; src/ and fixtures/ live outside.
    chosen: true
  - id: flat
    summary: Everything flat at repo root.
    chosen: false
  - id: docs-separate
    summary: A separate docs/ tree disconnected from schemas/code.
    chosen: false
decision: >
  `design/` is the parent umbrella for the living spec: `design/decisions/`,
  `design/contract/`, `design/schemas/`, and `design/web/` (the viewer that
  renders its siblings). Implementation code `src/` and conformance `fixtures/`
  live OUTSIDE `design/`.
governs:
  - repo
feature: [decision-system]
depends_on: [1, 24]
supersedes: []
---

## Reasoning

Grouping decisions, contract, schemas, and the viewer under one `design/` parent
makes the living spec a single, cohesive thing — the viewer renders exactly its
siblings, and a reader (or the [governance rule](0001-decisions-gate-code.md))
knows that everything under `design/` is "the spec." Keeping `src/` and
`fixtures/` outside `design/` keeps the boundary crisp: `design/` is *what and
why*, `src/` is *how*, and code is visibly downstream of the design it
implements.

```
evidence-cli/
  design/
    decisions/   ADRs (proposition → options → decision → reasoning)
    contract/    L0 pack layout, lifecycle, commands, config
    schemas/L0/  JSON Schema — single source of truth
    web/         Vite/React viewer rendering the above
  src/           validate, finalize, profile/config resolution
  fixtures/      valid-L0/, invalid-L0/
```

## Consequences

- The viewer reads `../decisions`, `../contract` from inside `design/web`.
- `src/` imports schemas from `src/schemas/0.1/L0` — the
  [single source of truth](0024-schemas-single-source-of-truth.md).
- **Amended by [0038](0038-schemas-canonical-home-in-src.md):** the L0 schemas moved out of `design/` to `src/schemas/0.1/L0/` (they are consumed by code, not merely rendered); the rest of this structure stands.

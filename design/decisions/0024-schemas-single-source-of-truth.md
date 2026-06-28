---
id: 24
slug: schemas-single-source-of-truth
title: Schemas are the single source of truth
status: accepted
date: 2026-06-26
proposition: >
  The validator needs schemas and the docs need to describe the same schemas.
  Do they share one definition or keep separate copies?
options:
  - id: json-schema-shared
    summary: Author the L0 schemas once as JSON Schema; both the validator and the viewer consume them.
    chosen: true
  - id: separate-doc-and-code
    summary: Maintain a doc description and a code schema independently.
    chosen: false
decision: >
  The L0 schemas under `design/schemas/L0/` are authored once as JSON Schema and
  are the single source of truth, consumed by BOTH `src/` (validate) AND
  `design/web` (the contract browser). Documentation cannot drift from the
  validator because they are the same files.
governs:
  - design/schemas/L0
  - src/
  - design/web
feature: [decision-system]
depends_on: [1]
supersedes: []
---

## Reasoning

Drift between "what the docs say" and "what the validator enforces" is the
classic way a spec loses trust. Eliminating the second copy eliminates the drift:
there is one artifact, the JSON Schema, and both the tool and the site read it.
This makes "full visibility" structural rather than a promise — the contract you
read is literally the contract that is enforced.

JSON Schema is the right shared format: a standard the validator can execute
directly (via a JSON Schema engine) and that the viewer can walk to render
human-friendly field tables. It also gives us, for free, the conditional rules
(e.g. require `ended`+`totals` when `finalized`) the
[status-gated validator](0018-status-gated-validation.md) needs.

This decision is what gives [0001](0001-decisions-gate-code.md)'s
"no docs drift from code" its mechanism.

## Consequences

- `src/` loads `design/schemas/L0/*.json` to validate; it does not redefine them.
- `design/web` renders those same files as the contract's field reference.
- Schema changes are contract changes and therefore require a decision.

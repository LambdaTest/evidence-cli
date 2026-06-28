# Governance

evidence-cli is an open format that other frameworks will adopt. To keep it
trustworthy and legible as it grows, this repo runs on one rule:

> **The decision is the unit of work. Code is downstream of it.**

This is itself a decision — [`design/decisions/0001-decisions-gate-code.md`](design/decisions/0001-decisions-gate-code.md).

## The rules

1. **No code without a decision.** Any change in behavior, schema, or contract
   starts as a decision record in [`design/decisions/`](design/decisions). New
   decision, or an amendment to an existing one.
2. **No code change without updating the structure.** A pull request that changes
   behavior without a corresponding decision (and, where relevant, an updated
   [contract page](design/contract) or [schema](design/schemas)) is incomplete by
   definition.
3. **Full visibility.** Every decision records its **proposition**, the
   **options** weighed, the **decision**, and the **reasoning** — all in the tree,
   all rendered by the [viewer](design/web).
4. **Schemas are the single source of truth.** The L0 JSON Schemas in
   [`design/schemas/L0/`](design/schemas/L0) are consumed by *both* the validator
   (`src/`) and the viewer (`design/web`). Docs cannot drift from the validator
   because they are the same files. See
   [decision 0024](design/decisions/0024-schemas-single-source-of-truth.md).

## A decision record

Each record is one markdown file with YAML frontmatter and a reasoning body. See
[decision 0022](design/decisions/0022-decision-record-format.md) for the format.
Minimum frontmatter:

```yaml
---
id: <n>
slug: <kebab-slug>
title: <short title>
status: proposed | accepted | superseded
date: YYYY-MM-DD
proposition: >
  the question this decision answers
options:
  - id: <slug>
    summary: <one line>
    chosen: true | false
decision: >
  the choice, stated plainly
governs:
  - <path or field this decision shapes>
feature: [<feature-id from design/features.yaml>]
depends_on: [<ids of decisions this one builds on>]
supersedes: []
---

## Reasoning
why this choice, and why not the others.
```

## Changing a past decision

Decisions are durable. To reverse one, add a **new** decision that records the new
proposition and reasoning, set the old one's `status: superseded`, and list the
old id in the new record's `supersedes`. History stays visible.

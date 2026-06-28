---
id: 1
slug: decisions-gate-code
title: Decisions gate code
status: accepted
date: 2026-06-26
proposition: >
  How do we keep this open-source format trustworthy and legible as it grows —
  so that anyone, on any framework, can see not just WHAT the format is but WHY
  every part of it is the way it is?
options:
  - id: decision-log-gates-code
    summary: A versioned decision log is the source of truth; no code lands without a decision, no change lands without updating the structure.
    chosen: true
  - id: code-first-docs-later
    summary: Write code, document after the fact.
    chosen: false
  - id: prose-spec
    summary: Maintain a single prose spec document alongside the code.
    chosen: false
decision: >
  The repo IS the spec. design/ holds decisions, contract, schemas and a web
  viewer that renders them. Every change starts as a decision record; no code
  lands without one; no code change lands without the structure being updated.
governs:
  - repo
  - design/
feature: [decision-system]
depends_on: []
supersedes: []
---

## Reasoning

evidence-cli will be open-sourced and adopted by frameworks we do not control.
A pile of code with stale comments — or a prose spec that drifts from the
validator — would erode trust fast. So we invert the usual order: **the
decision is the unit of work, and code is downstream of it.**

This is self-hosted. This very rule is decision `0001`; the web viewer renders
it next to every other decision so a newcomer can read the *reasoning* behind
the format, not just its shape.

Two structural consequences make drift impossible rather than merely
discouraged:

- The L0 schemas are the [single source of truth](0024-schemas-single-source-of-truth.md):
  the validator and the docs render the *same* files.
- Decisions declare what they `govern`, so the viewer can link a schema field
  back to the decision that shaped it.

## Consequences

- A pull request that changes behavior without a corresponding decision record
  (new or amended) is incomplete by definition.
- "Full visibility" is not a slogan: the proposition, the options we weighed,
  the choice, and the reasoning are all in the tree and all rendered.
- The cost is discipline on small changes. We accept it — the audience is every
  framework author who will ever evaluate whether to trust this format.

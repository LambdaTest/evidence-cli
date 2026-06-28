---
id: 26
slug: decision-graph
title: Decisions form a traceability graph
status: superseded
date: 2026-06-26
proposition: >
  The decisions are a flat list of 25+ files. A reader cannot see which are
  foundational, which build on others, or how a cluster of decisions produces a
  capability. How do we make the decision log legible as a structure?
options:
  - id: feature-decision-artifact
    summary: A three-tier traceability graph — Feature (spec area) ← Decisions ← the artifacts they govern — generated from frontmatter, rendered as an interactive node graph.
    chosen: true
  - id: feature-decision
    summary: Two tiers — features and the decisions that shaped them.
    chosen: false
  - id: decision-dag-only
    summary: A plain decision DAG with no first-class feature nodes.
    chosen: false
decision: >
  Decisions form a three-tier traceability graph — Feature ← Decision ← Artifact —
  generated from frontmatter (`feature`, `depends_on`, `governs`) and rendered as
  an interactive node graph. SUPERSEDED by decision 0032: the traceability data is
  kept, but it is now surfaced spec-first (each spec key links to its governing
  decisions) rather than as a standalone node graph.
governs:
  - design/features.yaml
  - design/decisions
  - design/web
feature: [decision-system]
depends_on: [22, 23]
supersedes: []
---

> **Superseded by [decision 0032](0032-spec-centric-navigation.md).** The
> `feature`/`depends_on`/`governs` traceability frontmatter this decision
> introduced still stands and is still generated; only its *presentation* changed
> — from a node graph to spec-first navigation where keys link to their decisions.

## Reasoning

A flat ADR list answers "what did we decide" but not "how does it fit together."
The connections already exist — every decision names what it `governs` and links
the decisions it builds on — they are just invisible. Making them a **graph**
turns the log into something you can navigate: enter from a capability ("why is
*Validate* the way it is?") and walk back through the decisions that produced it,
or start at the roots ([governance](0001-decisions-gate-code.md),
[agnostic](0002-framework-agnostic.md)) and follow the flow outward.

We chose three tiers because the goal is *a decision that leads to a spec or
feature*: **Feature ← Decision ← Artifact**. Feature nodes are the spec areas
(defined in [`features.yaml`](../features.yaml)); decision nodes carry a
`feature` (what they produce) and `depends_on` (the decisions they build on); the
`governs` field gives the artifact tier (the exact schema field / command / config
each decision lands in). A decision can feed several features — which is exactly
why this is a graph, not a tree.

The graph is **generated from frontmatter**, never hand-drawn, so it cannot drift
from the decisions — the same principle as
[schemas as the single source of truth](0024-schemas-single-source-of-truth.md).
It is rendered as an interactive node graph in the
[viewer](0023-viewer-custom-minimal.md) (a new Map view) with auto-layout and
click-through to each record.

## Consequences

- Every decision gains two frontmatter fields: `feature: [..]` and `depends_on: [..]`.
- `design/features.yaml` defines the feature/spec-area nodes and their spec targets.
- `design/web` gains a Map route (React Flow + dagre) building nodes/edges from
  decisions + features + governs.
- Adding a decision means tagging its `feature`/`depends_on` — the graph updates
  itself.

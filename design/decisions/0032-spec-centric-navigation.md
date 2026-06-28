---
id: 32
slug: spec-centric-navigation
title: Viewer is spec-centric — keys link to their decisions
status: accepted
date: 2026-06-28
proposition: >
  The decision graph (0026) renders Feature ← Decision ← Artifact as a node
  graph. In practice a reader arrives at the *spec* — a pack layout, a `run.yaml`
  key — and asks "why is this the way it is?". How should the viewer make that
  the primary motion?
options:
  - id: spec-first-click-to-decision
    summary: >
      Lead with the spec (contract + schema keys). Every key is selectable and
      transitions to the decision(s) that `govern` it, built from the same
      `governs` frontmatter the graph used. The node graph is retired.
    chosen: true
  - id: keep-graph
    summary: Keep the abstract Feature/Decision/Artifact node graph as the map.
    chosen: false
  - id: both
    summary: Keep the graph and add spec-first navigation alongside it.
    chosen: false
decision: >
  The viewer is SPEC-CENTRIC. The primary view renders the spec — pack layout and
  the L0 schema keys — and every key (and every nested field) is selectable: a
  selection transitions to the decision(s) that `govern` that key. The mapping is
  the reverse index of the existing `governs` pointers (e.g.
  `result.schema.json#/properties/definition`), so it stays generated, never
  hand-drawn. The abstract node-graph map (0026) is RETIRED in favor of this.
governs:
  - design/web
  - design/features.yaml
feature: [decision-system]
depends_on: [22, 24, 26]
supersedes: [26]
---

## Reasoning

The traceability data [0026](0026-decision-graph.md) built was right; its
*entry point* was wrong. A newcomer does not think "show me feature
`result-model`" — they think "what is this `definition` key, and who decided it
must be opaque?" A node graph answers the first question; the spec is where the
second one starts. So we invert the view: the spec is the map, and each key is a
doorway to its reasoning.

The machinery barely changes — this is why the inversion is cheap. `governs`
already pins each decision to exact schema pointers and contract pages
([record format](0022-decision-record-format.md)); we just index it the other
way (key → decisions instead of decision → keys). The
[schema-as-source-of-truth](0024-schemas-single-source-of-truth.md) field table
the viewer already renders becomes the clickable surface, so the mapping cannot
drift from the schema or the decisions — the same guarantee the graph had.

Retiring the graph (rather than keeping both) keeps one canonical way to navigate
the reasoning and removes the React-Flow/dagre surface area. Features remain in
`features.yaml` as the coarse grouping a key's decisions roll up to, but they are
no longer a separate visual tier.

## Consequences

- `0026` is superseded; the `/map` node-graph route and its
  React-Flow/dagre/graph code are removed.
- The viewer builds a `governs` reverse index (key-path → decisions) and makes
  schema field rows and pack-layout entries selectable, transitioning to the
  governing decision card(s).
- A key with no `governs` match is simply inert — the view never breaks on a
  not-yet-decided field, mirroring the loader's "never crash on absence" rule.

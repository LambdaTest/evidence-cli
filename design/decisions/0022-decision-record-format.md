---
id: 22
slug: decision-record-format
title: Decision record format — frontmatter markdown
status: accepted
date: 2026-06-26
proposition: >
  What is the canonical format of a single decision record — the unit the viewer
  renders as proposition → decision → reasoning?
options:
  - id: frontmatter-md-hybrid
    summary: One .md per decision with structured YAML frontmatter + a markdown reasoning body.
    chosen: true
  - id: pure-prose-adr
    summary: Classic ADR prose template, no structured frontmatter.
    chosen: false
  - id: structured-data-plus-md
    summary: YAML/JSON records with reasoning in a linked markdown file.
    chosen: false
decision: >
  Each decision is one markdown file with structured YAML frontmatter
  (`id`, `slug`, `title`, `status`, `date`, `proposition`, `options[]`,
  `decision`, `governs[]`, `feature[]`, `depends_on[]`, `supersedes[]`) followed
  by a markdown body holding the reasoning. `feature[]` and `depends_on[]` were
  added by [decision 0026](0026-decision-graph.md) (traceability) and are part of
  the canonical shape; field order is `governs` → `feature` → `depends_on` →
  `supersedes`.
governs:
  - design/decisions
  - design/web
feature: [decision-system]
depends_on: [1]
supersedes: []
---

## Reasoning

The record must be two things at once: pleasant for a human to write and read in
a pull request (so, markdown — "MDs are good"), and structured enough for the
[viewer](0023-viewer-custom-minimal.md) to render proposition→options→decision
as discrete UI and to link a decision to the schema fields it `governs`. Pure
prose loses the structure; pure data loses the readability. Frontmatter markdown
is the hybrid that keeps both — git-diffable, human-writable, machine-renderable.

The `governs` field is what makes the system navigable: it ties each decision to
the part of the [schema](0024-schemas-single-source-of-truth.md) or repo it
shaped, so the viewer can cross-link contract ↔ decision in both directions.

## Consequences

- All files in `design/decisions/` follow this frontmatter shape.
- The viewer parses frontmatter (with js-yaml in the browser, not gray-matter)
  and renders the body as markdown beneath the structured header.

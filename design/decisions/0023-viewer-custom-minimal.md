---
id: 23
slug: viewer-custom-minimal
title: Viewer is a custom, minimal-but-real local site
status: accepted
date: 2026-06-26
proposition: >
  How is the local viewer built — and how polished for this first stage — so
  anyone can browse the structure and the decisions?
options:
  - id: custom-minimal-real
    summary: A lightweight custom Vite/React local site (landing + contract + decisions). Functional first, polish later.
    chosen: true
  - id: off-the-shelf-docs
    summary: Use an off-the-shelf docs generator (Starlight/Docusaurus/MkDocs).
    chosen: false
  - id: tiny-markdown-server
    summary: A minimal markdown folder server.
    chosen: false
decision: >
  A custom, minimal-but-real Vite/React local site under design/web. It has three
  areas: a loud landing on framework-agnostic combinability, a contract browser
  (pack layout + rendered schemas), and a decisions log rendering each record as
  proposition → options → decision → reasoning. Functional first; polish iterates.
governs:
  - design/web
feature: [decision-system]
depends_on: [1, 22, 24]
supersedes: []
---

## Reasoning

This site is the open-source face of the format — it must "speak loudly" that
evidence works with *any* framework, and it must render the
[decision records](0022-decision-record-format.md) as real structured cards, not
just dumped markdown. A custom site gives full control of that landing story and
of cross-linking decisions to the schema fields they govern.

An off-the-shelf generator (Starlight/Docusaurus) would be faster and bring
search for free, but cedes control of the loud landing and of the bespoke
proposition→decision→reasoning rendering. A tiny markdown server is too plain to
carry the positioning. We accept building a little more now for a viewer that
matches the ambition; it stays minimal-but-real and can be upgraded later.

It reads its content from the sibling
[schemas](0024-schemas-single-source-of-truth.md), `contract/`, and
`decisions/`, so the docs cannot drift from the source of truth.

## Consequences

- `design/web` is a self-contained Vite/React app reading `../decisions`,
  `../contract`, `../schemas`, and the design overview.
- Built in [TypeScript/Node](0019-runtime-typescript-node.md), the same
  toolchain as `src/`.

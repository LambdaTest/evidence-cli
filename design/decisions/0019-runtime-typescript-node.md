---
id: 19
slug: runtime-typescript-node
title: Runtime is TypeScript/Node
status: accepted
date: 2026-06-26
proposition: >
  What language/runtime should evidence-cli be built in, given it will later
  mount as `kane-cli evidence` (and kane-cli is TypeScript/Node)?
options:
  - id: typescript-node
    summary: TypeScript/Node — mounts in-process into kane-cli, shared types, no subprocess.
    chosen: true
  - id: go
    summary: Go — single static binary; mounts as a spawned binary.
    chosen: false
  - id: python
    summary: Python — matches v16-runner; mounts via subprocess.
    chosen: false
decision: >
  evidence-cli is built in TypeScript/Node. It exposes `validate` and `finalize`
  as library functions and a thin CLI, so kane-cli mounts it in-process as
  `kane-cli evidence` with shared types and no subprocess boundary.
governs:
  - src/
  - design/web
feature: [runtime]
depends_on: []
supersedes: []
---

## Reasoning

The first concrete consumer is kane-cli, which is TypeScript/Node. A TS
implementation mounts by direct import — `kane-cli evidence` becomes a
subcommand calling `validate()`/`finalize()` with shared types, no IPC, no
serialization boundary. That is the cheapest path to the mounting goal and keeps
the contract types identical on both sides.

Go would give a single static binary (nice for standalone OSS distribution) but
adds a cross-language boundary to mount into kane-cli. Python matches the runner
stack but has the same subprocess cost and a heavier runtime dependency. For a
format library whose primary host is a Node CLI, TS wins.

The [web viewer](0023-viewer-custom-minimal.md) is also a Node/Vite toolchain, so
one toolchain covers both `src/` and `design/web/`.

## Consequences

- `src/` is TypeScript; the package exports library functions plus a `bin`.
- Distribution is via npm; a Node runtime is assumed (acceptable for the OSS
  audience and required by the kane-cli host anyway).

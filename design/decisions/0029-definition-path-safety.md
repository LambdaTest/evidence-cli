---
id: 29
slug: definition-path-safety
title: definition.path must be a contained relative path
status: accepted
date: 2026-06-28
proposition: >
  `definition.path` is authored by the producer and `finalize` reads the file at
  that path to hash it. What stops a path from escaping the test directory
  (`../../etc/passwd`) or being absolute (`/etc/...`)?
options:
  - id: contained-relative-only
    summary: >
      `path` MUST be relative and stay inside its test directory — no leading
      `/`, no `..` segments, no scheme. Enforced by a schema pattern plus a
      validator normalization check.
    chosen: true
  - id: trust-producer
    summary: Accept any string; trust the producing framework not to escape.
    chosen: false
  - id: flatten-name-only
    summary: Forbid all subdirectories — `path` must be a bare filename.
    chosen: false
decision: >
  `definition.path` MUST be a relative path contained within its
  `tests/<id>/` directory: no leading `/`, no `..` segment, no URL scheme. The
  schema enforces the shape with a `pattern`; `finalize`/`validate` additionally
  normalize the path and reject anything that resolves outside the test
  directory. Subdirectories are allowed (a framework may keep `src/login.spec.ts`),
  bare filenames are the common case.
governs:
  - src/schemas/0.1/L0/result.schema.json#/properties/definition
feature: [definition]
depends_on: [5]
supersedes: []
---

## Reasoning

evidence-cli opens and hashes a path it did not choose — the framework
[pre-declares it](0005-definition-located-by-path.md). A format that other
frameworks emit, and that CI systems unzip and process, cannot let that path
reach arbitrary files: `../../../etc/passwd` or an absolute path would turn a
"hash the definition" step into a file-read primitive over the host. Containment
is the safe default and costs producers nothing — the definition genuinely lives
beside its `result.yaml`.

We keep subdirectories legal because some frameworks nest their native artifact
(`tests/login/src/login.spec.ts`); forbidding all subpaths would be needlessly
strict. The constraint is only *containment*: the resolved path must stay under
`tests/<id>/`. JSON Schema's `pattern` catches the obvious shapes (leading slash,
`..`); the validator does the authoritative normalization check, since a regex
alone cannot fully reason about path traversal.

## Consequences

- The result schema's `definition.path` gains a `pattern` rejecting absolute
  paths, `..` segments, and schemes.
- `finalize` and `validate` normalize `path` and fail if it escapes the test
  directory — a [validator cross-check](0031-validator-cross-checks.md) that
  pure schema cannot express.

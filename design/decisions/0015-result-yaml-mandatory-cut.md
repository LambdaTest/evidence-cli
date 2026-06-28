---
id: 15
slug: result-yaml-mandatory-cut
title: result.yaml mandatory cut for L0 v0.1
status: accepted
date: 2026-06-26
proposition: >
  Which result.yaml fields are mandatory at L0, and must a failing step carry a
  human-readable reason?
options:
  - id: minimal-core-optional-forensics
    summary: MUST = evidence, test, status, steps[] (each step id/ordinal/status); failure detail (expected/actual/defect/check) fully optional.
    chosen: true
  - id: require-reason-on-failure
    summary: Require at least one reason field whenever a step is failed/broken.
    chosen: false
  - id: require-full-forensics
    summary: Require expected/actual/defect on non-passing steps.
    chosen: false
decision: >
  result.yaml MUST carry `evidence`, `test`, `status`, and `steps`. Each step
  MUST carry `id`, `ordinal`, `status`. Everything else — including failure
  forensics (expected/actual/defect/check) — is optional at L0.
governs:
  - design/schemas/L0/result.schema.json#/required
  - design/schemas/L0/result.schema.json#/$defs/step/required
feature: [result-model]
depends_on: [6, 8, 4]
supersedes: []
---

## Reasoning

L0 records *that* something happened with a parseable shape; the rich forensics
that explain *why* are the value of higher levels. The minimal core — format
version, test id, verdict, and an ordered step list keyed by id/ordinal/status —
is enough to compute totals, render a pass/fail view, and trace each result to
its [definition](0004-definition-required-but-opaque.md).

We deliberately did not require a reason on `failed`/`broken` steps. Mandating
forensics at L0 would burden minimal producers and blur the line between L0
(minimal) and L1+ (forensic). The example packs that carry `expected`/`actual`/
`defect`/`check` are richer-than-L0 views; at L0 those fields are available but
never required.

The [`steps[]` array may be empty](0008-steps-execution-derived.md), and test
`status` is [authored, not derived](0016-test-status-authored.md).

## Consequences

- The step schema's `required` is exactly `[id, ordinal, status]`.
- Optional step fields (kind, duration_ms, durable_id, defect, expected, actual,
  check) and optional test fields (params_hash, external_id, duration_ms,
  attempts, flaky, tags, requirements) are validated only when present. Keys are
  [snake_case](0036-snake-case-keys.md); [`attempts` is a per-attempt outcome
  list](0033-attempts-and-flaky.md), not a scalar count.

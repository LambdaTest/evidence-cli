---
id: 36
slug: snake-case-keys
title: All format keys are snake_case
status: accepted
date: 2026-06-28
proposition: >
  The L0 schemas mixed casing: `run_id`/`duration_ms` (snake) alongside
  `paramsHash`/`externalId` (camel). What single convention do keys follow?
options:
  - id: snake-case-all
    summary: >
      Every key in the format is snake_case. Rename `paramsHash`→`params_hash`,
      `externalId`→`external_id`. No mixed casing anywhere.
    chosen: true
  - id: camel-case-all
    summary: Normalize everything to camelCase instead.
    chosen: false
  - id: leave-mixed
    summary: Accept the mixture.
    chosen: false
decision: >
  Every key in the evidence format is `snake_case`. The camelCase strays
  `paramsHash` and `externalId` are renamed to `params_hash` and `external_id`.
  No mixed casing is permitted in any schema, at any profile, going forward.
governs:
  - design/schemas/L0/run.schema.json
  - design/schemas/L0/result.schema.json
feature: [run-model, result-model]
depends_on: [24]
supersedes: []
---

## Reasoning

An open format that many frameworks emit and many tools parse must be
predictable: a producer should never have to remember which keys are camel and
which are snake. The existing core already leaned snake — `run_id`, `started`,
`ended`, `duration_ms`, `durable_id` — so the two camelCase fields
(`paramsHash`, `externalId`) were the outliers, and snake is the lower-churn,
more YAML-idiomatic choice. One convention, applied everywhere, removes a whole
class of "why didn't my field parse" mistakes.

This is settled now, pre-`0.1`-release, precisely so it never becomes a
[breaking change](0027-evidence-version-and-profiles.md) later: renaming a key
after packs exist in the wild would force a version bump. Doing it before any
producer ships keeps it free.

## Consequences

- `result.schema.json`: `paramsHash` → `params_hash`, `externalId` →
  `external_id`. Other keys already conform.
- Any future field, at any profile, is authored in snake_case — enforced in
  review against the [single source of truth](0024-schemas-single-source-of-truth.md).

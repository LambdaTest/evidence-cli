---
id: 8
slug: steps-execution-derived
title: Steps are execution-derived and may be empty
status: accepted
date: 2026-06-26
proposition: >
  Where do a test's steps come from, what granularity do they have, and must
  they mirror the definition?
options:
  - id: execution-derived-producer-choice
    summary: steps[] are ordered execution outcomes; the framework chooses granularity; may be empty; need not mirror the definition.
    chosen: true
  - id: mirror-definition
    summary: steps must mirror the structure of the definition.
    chosen: false
  - id: fixed-granularity
    summary: evidence-cli fixes what a step is.
    chosen: false
decision: >
  `steps[]` is an ordered list of execution outcomes. The framework decides what
  a step is and how granular it is. The array MAY be empty (a unit or API test
  may have no sub-steps). evidence-cli does not require steps to mirror the
  definition.
governs:
  - src/schemas/0.1/L0/result.schema.json#/properties/steps
feature: [result-model]
depends_on: [6, 2]
supersedes: []
---

## Reasoning

Steps describe *what happened during execution*, not the structure of the test's
intent. A browser run yields `navigate`/`input`/`assertion` actions; a unit test
yields a single pass/fail. Forcing steps to mirror the definition, or fixing a
granularity, would re-introduce framework assumptions the format is built to
avoid. So granularity is the producer's choice and the array can be empty.

Because steps need not mirror the definition (which is
[opaque](0004-definition-required-but-opaque.md) anyway), the test
[`status` is authored](0016-test-status-authored.md) rather than computed from
steps — derivation isn't always possible when `steps[]` is empty.

For the kane framework specifically (a consumer, not the contract): steps come
from the execution trace (`action.ndjson`), and the run-level `## objective` is
*test-level intent* that lives inside the opaque definition — it is not a step.

## Consequences

- The result schema allows `steps: []`.
- Step `kind` is an [open string](0009-step-kind-open-string.md), consistent with
  granularity being the producer's call.

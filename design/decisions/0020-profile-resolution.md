---
id: 20
slug: profile-resolution
title: Profile resolution order
status: accepted
date: 2026-06-26
proposition: >
  A pack is validated against a profile (L0 now; L1–L3 and others later). How is
  the active profile chosen for a `validate` invocation?
options:
  - id: flag-config-default
    summary: --profile flag, else config defaultProfile, else built-in default.
    chosen: true
  - id: flag-only
    summary: --profile must always be passed.
    chosen: false
  - id: config-only
    summary: Profile comes only from config.
    chosen: false
decision: >
  The active profile resolves as: `--profile` flag → config `defaultProfile` →
  built-in default (L0). Profiles are additive; adding a new profile never
  changes the core format.
governs:
  - src/
  - design/contract
feature: [validate, profiles-config]
depends_on: [21]
supersedes: []
---

## Reasoning

A three-tier resolution gives both ergonomics and explicitness: a caller can be
explicit per-invocation (`--flag`), a project can set its norm once
(`config.defaultProfile`), and there is always a sane fallback so the command
works with zero configuration. This mirrors how most well-behaved CLIs resolve
settings and avoids forcing a flag on every call.

Profiles are an *additive* axis. L0 is the minimal core; higher and orthogonal
profiles (L1–L3, browser, mobile, a11y, security) only *add* assertions and
finding layers — a brand-new profile is purely additive and never rewrites the
core format. Resolution therefore only selects *which* set of assertions to run,
never *which* format to expect.

## Consequences

- `validate` reads the flag, then [config](0021-config-location.md), then the
  built-in default.
- The profile system is designed so new profiles slot in without touching L0.

---
id: 21
slug: config-location
title: Config location — ~/.testmuai/evidence
status: accepted
date: 2026-06-26
proposition: >
  Where does evidence-cli read its config, balancing the testmuai brand against
  open-source neutrality?
options:
  - id: testmuai-evidence-with-override
    summary: Default ~/.testmuai/evidence/config.json (brand present, not under kaneai); override via env/flag.
    chosen: true
  - id: xdg-neutral
    summary: Neutral XDG default (~/.config/evidence/config.json).
    chosen: false
  - id: kaneai-nested
    summary: Nest under ~/.testmuai/kaneai/evidence.
    chosen: false
decision: >
  evidence-cli reads `~/.testmuai/evidence/config.json` by default — branded
  under testmuai, but NOT nested under kaneai (evidence-cli is its own entity,
  not a kane sub-tool). The location is overridable via the `EVIDENCE_CONFIG`
  env var or a `--config` flag for fully standalone use. The config holds
  `defaultProfile` and is extensible to multiple profiles/configs later.
governs:
  - src/
  - design/contract
feature: [profiles-config]
depends_on: []
supersedes: []
---

## Reasoning

evidence-cli is a standalone, open-sourced entity, so it should not live under
`kaneai/` — that would imply it is a kane component. But the brand still belongs
in the path, so `~/.testmuai/evidence/` keeps the testmuai namespace while
signaling evidence-cli is a peer, not a child, of kane.

For the purely standalone open-source case, the `EVIDENCE_CONFIG` env var and
`--config` flag let an adopter point anywhere, so the brand default never traps
a non-testmuai user. The config currently holds only
[`defaultProfile`](0020-profile-resolution.md) but is structured to grow into
multiple named configs/profiles.

## Consequences

- Config resolution: `--config` flag → `EVIDENCE_CONFIG` env → `~/.testmuai/evidence/config.json`.
- A missing config is fine: the built-in default profile (L0) applies.

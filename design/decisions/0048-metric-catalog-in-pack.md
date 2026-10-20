---
id: 48
slug: metric-catalog-in-pack
title: Metric catalogs — the built-in evidence-core catalog and a producer snapshot in the pack
status: accepted
date: 2026-10-21
proposition: >
  0012 makes run.yaml.metrics an open map of typed facts but says nothing about
  what a name means or how a reader can check it. A policy (0047) needs both:
  which names exist, which operators suit each, and how to get a trustworthy
  value. Where do those definitions live, how does a producer add its own, and
  how does a sealed pack stay judgeable offline years later?
options:
  - id: catalog-format-plus-snapshot
    summary: >
      One catalog format for everyone. evidence-cli ships the built-in
      evidence-core catalog (recompute-only, unprefixed names); a producer
      snapshots its own catalog into the pack at meta/metrics-catalog.yaml and
      records it in run.yaml metrics_catalog. The verdict reads only the
      pack's snapshot.
    chosen: true
  - id: catalog-fetched-at-judge-time
    summary: The verdict fetches the producer's current catalog when it runs.
    chosen: false
  - id: trust-run-yaml-types
    summary: No catalog; gate directly on run.yaml.metrics {value, type}.
    chosen: false
decision: >
  A METRIC CATALOG (`src/schemas/metrics-catalog.schema.json`) is
  `{catalog: <id>, version: <int | "n.n">, min_producer?, metrics: {<name>:
  {type, unit?, label?, description?, range?, values?, per_test?, verify,
  merge?, min_producer?}}}`. Names are snake_case and dot-separated (0036).
  `type` is one of count, integer, ms, bytes, currency (operators equals, min,
  max, range, in), ratio, percentage, decimal (min, max, range), string, enum
  (equals, in). `verify` says how a value is obtained and what trust it earns:
  `stored` reads `run.yaml.metrics.<name>` and checks its type, unit and range
  (trust `stored`); `{file, path}` reads a dot-path from a contained
  .yaml/.yml/.json file in the pack (trust `file`); `{aggregate, over?, path? |
  value?, where?}` folds a per-test value (sum, min, max, mean, count, p50, p90,
  p95) over `tests/*/<file>`, default `tests/*/result.yaml` (trust
  `recomputed`); `{expr}` evaluates CEL over the pack facts (0049, trust
  `recomputed`). When a recomputable metric ALSO has a stored value in
  `run.yaml.metrics`, the two must agree, else the gate errors
  (`verdict.stored_mismatch`) and the stored number is reported beside the
  recompute. evidence-cli SHIPS the `evidence-core` catalog
  (`src/schemas/0.1/evidence-core.catalog.yaml`, version "0.1"): `totals.tests`,
  `totals.passed`, `totals.failed`, `totals.broken`, `totals.skipped`,
  `pass_rate` (passed ÷ (tests − skipped)), `steps.total`, `steps.failed`,
  `steps.skipped` (all per_test), `run.duration_ms`, `run.status`,
  `failures.count`. Built-in names are unprefixed and RESERVED — a producer
  catalog may not define one — and built-ins never use `stored`. A producer
  metric is always reached as `metrics.<name>`. THE SNAPSHOT: a producer copies
  its catalog to `meta/metrics-catalog.yaml` and records `run.yaml
  metrics_catalog: {id, version, sha256, source}` (sha256 = hex of the snapshot
  bytes; `source` is the producer's own word for where it came from).
  `validate` checks, at any status: the block names a snapshot that exists
  (`catalog.missing`), parses and conforms (`catalog.parse`, `catalog.schema`,
  plus the catalog's own rules `catalog.reserved_name`, `catalog.expr`,
  `catalog.path_escape`, `catalog.merge_rule`), hashes to the recorded sha256
  (`catalog.hash_mismatch`), and carries the recorded id and version
  (`catalog.identity_mismatch`); a snapshot with no block is a warning
  (`catalog.unreferenced`). The verdict reads ONLY the pack's snapshot, never a
  network copy. A pack with no catalog can still be judged on built-ins; a
  `metrics.*` gate on it errors (`verdict.catalog_missing`) and a policy whose
  `requires` names a catalog errors as a whole (`policy.catalog_required`).
  MERGED PACKS (`merged_from` present): built-ins are recomputed over the
  merged tests unchanged; a producer metric follows its `merge` rule — `sum`,
  `min`, `max`, `mean` combine every source's stored `<label>/<name>` value,
  `recompute` re-runs an aggregate/expr verify over the merged tests, `none`
  (the default) errors the gate (`verdict.merge_none`). `evidence merge` keeps
  the snapshot and the `metrics_catalog` block when every eligible source
  carries the byte-identical snapshot; otherwise the merged pack carries none.
  Pack identity for a verdict is the sha256 of the sealed `.evidence` file
  bytes; no `checksums.txt` is added.
governs:
  - src/schemas/metrics-catalog.schema.json
  - src/schemas/0.1/evidence-core.catalog.yaml
  - src/schemas/0.1/L0/run.schema.json#/properties/metrics_catalog
  - src/validate
  - src/merge/assemble.ts
  - src/verdict
feature: [verdict, run-model]
depends_on: [12, 36, 45, 47, 49]
supersedes: []
---

## Reasoning

**Why the pack carries its own catalog.** A verdict must be reproducible: the
same pack and policy give the same answer next year. If the verdict fetched
the producer's current catalog (`catalog-fetched-at-judge-time`), a catalog
update would silently change old verdicts and the tool would need the network.
Snapshotting at seal time pins the meaning of every metric to the pack, and the
recorded sha256 lets `validate` prove the snapshot is the one the producer
wrote.

**Why not just trust `run.yaml.metrics`.** 0012's `{value, type}` is a claim by
the producer. With no definition (`trust-run-yaml-types`) a policy cannot know
which operators make sense, and a wrong stored number would pass unnoticed.
The catalog lets most metrics be RECOMPUTED from the raw files and lets a
stored number be cross-checked against its recompute.

**Why one format for built-ins and producers.** The same lint and the same
resolver handle both. Built-ins differ only in that they are reserved,
unprefixed, never `stored`, and need no snapshot, so any pack from any producer
can be gated on `totals.failed` with no catalog at all.

**Why pack identity is the zip's sha256.** The verdict is a sidecar (0050) and
must name the exact bytes it judged. The sealed file is what is uploaded and
stored, so its sha256 identifies it with no new file inside the pack and no
change to `finalize`.

**Why merge keeps only an identical snapshot.** One merged pack can carry one
catalog. When every source sealed the same catalog the copy is exact; when
they differ there is no single truthful catalog, so the merged pack carries
none and `metrics.*` gates error rather than being judged against the wrong
definitions.

## Consequences

- `run.schema.json` gains the optional `metrics_catalog` block (additive; no
  0.1 pack is invalidated). `meta/` holds the snapshot.
- `validate` gains the `catalog.*` checks; `merge` keeps an identical snapshot.
- The catalog format includes `min_producer` so a catalog service can hand a
  producer only a catalog it can satisfy; the verdict ignores it.
- Deferred: per-source catalogs on a merged pack, policy references to one
  merged source's metric, counting lines in log files as a verify kind.

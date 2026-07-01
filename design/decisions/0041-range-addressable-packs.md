---
id: 41
slug: range-addressable-packs
title: Range-addressable packs — stream artifacts from a blob, don't download the whole zip
status: accepted
date: 2026-06-30
proposition: >
  An L1 pack is large — logs, per-step screenshots, coverage, optional video can
  reach hundreds of MB — yet most consumers need only a sliver: a CI dashboard
  wants `run.yaml` + each `result.yaml`; a validator's presence checks need only
  the entry list; a viewer wants one screenshot on click. Must a consumer fetch
  the entire `.evidence` zip from blob storage to read any of it, or can it stream
  just the entries it needs — and what must the format guarantee to keep that
  possible?
options:
  - id: range-addressable-zip
    summary: >
      Keep the single sealed zip canonical and GUARANTEE it stays
      central-directory-addressable: a consumer reads the central directory, then
      ranged-reads only the entries it needs. finalize keeps the layout flat,
      never double-wraps/solid-compresses, and STOREs already-compressed
      artifacts; readers support ranged access + ZIP64. A `RemoteZipContainer`
      implements the existing container interface.
    chosen: true
  - id: download-whole-pack
    summary: >
      Status quo — every consumer downloads the entire `.evidence` zip before
      reading anything.
    chosen: false
  - id: exploded-blob-form
    summary: >
      Replace the zip with an exploded object-per-artifact layout in the blob
      store (a manifest plus one object per file).
    chosen: false
decision: >
  The sealed `.evidence` zip stays the ONE canonical artifact (0003, 0039), and
  the format GUARANTEES it remains RANGE-ADDRESSABLE: a conformant consumer MAY
  read only the zip's central directory (the entry manifest — names, sizes,
  offsets) and then ranged-read only the specific entries it needs, against any
  blob store that supports HTTP Range. To keep that property real, `finalize` MUST
  keep the archive flat (0028) and MUST NOT wrap it in an outer compression stream
  or solid-compress it, and SHOULD store already-compressed artifacts (images,
  video, gzipped logs) with the zip STORE method so each is a contiguous,
  directly range-able byte span; conformant readers MUST support ZIP64 and ranged
  access. Streaming is an ACCESS STRATEGY layered on the existing container
  interface — a `RemoteZipContainer` joining the directory and local-zip
  containers (0040) — and changes how a pack is READ, never the format. An
  optional exploded at-rest mirror is permitted, but the zip stays canonical for
  seal, transport, and hashing.
governs:
  - design/contract/01-pack-layout.md
  - src/
feature: [pack-format, finalize]
depends_on: [3, 28, 39, 40]
supersedes: []
---

## Reasoning

A zip is already a random-access container: its **central directory sits at the
tail** and maps every entry name to its offset, compressed size, and method. So a
reader can fetch the end of the object, parse that directory, and then issue a
ranged GET for just the bytes of the entries it wants — each entry is stored
independently. The [flat layout](0028-zip-internal-layout.md) makes the names
predictable (`run.yaml`, `tests/<id>/result.yaml`, `tests/<id>/logs/…` at the
archive root), so "read the manifest and every result.yaml" is a handful of ranged
reads, not a full download.

The payoff is structural, not incidental. What L1 validation actually reads —
existence, naming, declared format, containment ([0040](0040-l1-profile-evidence-artifacts.md)) —
comes from the **central directory alone**: "is there an entry at
`…/steps/1-open-checkout/screenshot.png`?" is a map lookup, not a byte fetch. The
heavy artifacts are [opaque](0004-definition-required-but-opaque.md) and never read
during validation. So presence/structure checks, and dashboards that want only the
YAML facts, touch kilobytes of a pack that may be hundreds of MB. The cost of L1
was never in validation; it was in transporting the whole file — which selective
streaming removes. `download-whole-pack` makes every read O(pack size) and wastes
that, for exactly the consumers (CI, viewers) who read the least.

**Why guarantee the property instead of leaving it to luck.** Today's flat zip is
*already* range-addressable — but nothing stops a later change from quietly killing
it: an outer gzip stream over the whole archive, solid/dictionary compression
across entries, or re-introducing a wrapper directory would each force whole-pack
reads again. Stating range-addressability as a contract property (and pinning the
finalize behaviors that preserve it) protects a capability we otherwise only have
by accident — the same instinct behind keeping the [layout flat](0028-zip-internal-layout.md)
in the first place.

**Why STORE already-compressed artifacts.** Deflating a PNG, WebP, MP4, or a
gzipped log wastes finalize time for ~0 size gain (they are already entropy-coded).
Storing them uncompressed costs nothing and buys two things: faster
[finalize](0039-finalize-seal-replaces-directory.md), and a *contiguous* byte span
per artifact — so a viewer can HTTP-range straight into a video for scrubbing, not
just fetch-whole-then-play. Ranged reads select *which* entry; STORE additionally
makes *within*-entry ranges meaningful for media. (DEFLATE entries stay
range-selectable too — you fetch the compressed slice and inflate locally — so this
is a SHOULD, not a MUST.)

**Why keep the zip canonical, not go exploded.** An exploded object-per-artifact
layout (`exploded-blob-form`) streams even more trivially, but it dissolves the one
thing the [sealed pack](0003-pack-model-and-manifest-anchor.md) exists to be: a
single, portable, hashable artifact that `finalize`
[produces in place](0039-finalize-seal-replaces-directory.md). We keep the zip as
the canonical sealed form and allow an exploded copy only as an optional at-rest
mirror for hot storage — never as the thing you seal, transport, or hash.

**Why this needs no format change — but does need a decision.** The reader is a
third implementation of the [container primitives](0040-l1-profile-evidence-artifacts.md)
(`exists`/`isDir`/`listDir`/`readText`) that already abstract "directory vs flat
zip"; a `RemoteZipContainer` serves `exists`/`isDir`/`listDir` from the cached
central directory and `readText` from a single ranged read, and the validator and
viewer are unchanged. So no schema or pack-shape changes. But *guaranteeing*
addressability, pinning the finalize STORE/no-outer-wrap rules, and requiring
ZIP64/ranged support of readers are new contract properties — hence a decision.

## Consequences

- [`01-pack-layout.md`](01-pack-layout.md) gains an **addressability** note: the
  sealed zip is range-addressable; the flat layout and the no-outer-wrapping /
  no-solid-compression rules exist to preserve it.
- `finalize` ([0039](0039-finalize-seal-replaces-directory.md)): keeps entries flat
  at the archive root, never double-wraps or solid-compresses, and STOREs
  already-compressed artifacts (selected by an incompressibility heuristic, e.g.
  known media/compressed extensions). The L0 YAML/definition entries may still
  DEFLATE.
- `src/` gains a `RemoteZipContainer` behind the existing container interface:
  read the EOCD/central directory (handling ZIP64), cache the entry map, then per
  entry read its local header + data slice via ranged blob GETs. The
  directory/local-zip containers are unchanged.
- Readers MUST handle **ZIP64** — packs over 4 GB or 65 535 entries need it, and
  large L1 packs are exactly where streaming matters most.
- Connects to deferred work: if [artifact hashing](0040-l1-profile-evidence-artifacts.md)
  is added later, a streaming consumer can verify just the one artifact it pulled.
  A sidecar offset index (skipping the central-directory round-trip) is a possible
  later optimization, not required now.
- The addressability note (`01-pack-layout.md`) and the finalize STORE rule
  (`03-commands.md`) have landed with this decision's acceptance; the
  `RemoteZipContainer` and the finalize STORE-by-incompressibility behavior land
  with the `src/` implementation.

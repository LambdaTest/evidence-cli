# Example: a kane-cli pack — one format, one viewer

This directory holds a **real `.evidence` pack produced by kane-cli**
(`kane-cli.evidence/`) and this walkthrough. It exists to make one claim concrete:

> The viewer consumes only the sealed pack layout and the JSON Schemas — never the
> producer. So **any** tool that emits a conformant pack loads in the **same**
> viewer. kane-cli is just producer #1; a Playwright, Jest, or API-check producer
> that writes this same shape renders identically.

kane-cli is an AI browser agent: it drives a real browser to author a test, then
records what the run produced. It does **not** reimplement the format — it depends
on the published `@testmuai/evidence-cli` package and delegates *seal / validate /
merge / read* to it (`kane-cli/src/evidence/adapter.ts`), while writing `run.yaml`
and `result.yaml` with its own writers. That makes it a clean reference producer.

## The run

An actual kane-cli **0.8.3** session (`origin: inline`, `run_kind: author`):

> *"go to https://ltqa-domsetu.vercel.app/ switch to nested iframe and complete the
> checkout flow"*

The agent drove a real Chrome (macOS, Desktop/web, model `v16-alpha`) through a
27-step nested-iframe e-commerce checkout on a public practice site — navigate,
select, scroll, click, and fill the shipping/payment forms — and passed. Every step
carries a real screenshot the viewer shows.

> **Sanitized for publishing.** This repo is public, and a live pack embeds
> account context and secrets (the `local-server.ts` that serves packs literally
> warns "packs can embed secrets"). The *run* is untouched — 27 real steps, 27 real
> screenshots, the real `result.yaml`/step records, and the real 110-request
> network HAR are all verbatim. What was redacted is only the account identity:
> `external_id` ids/email → neutral placeholders, the share-link (an access token)
> removed, the auth/token lines in `tui.log` replaced with a clean boot trace, the
> `secrets.user.CVV` value in `test.md` masked, and the opaque
> `auteur/execution.json` trajectory dropped. The pack still validates at L1.

## The pack

```
kane-cli.evidence/
  run.yaml                                  # L0 — manifest anchor: run identity, lifecycle, derived totals
  coverage/.keep                            # L1 — global coverage/ dir (present; opaque to the format)
  failure.yaml                              # L1 — finalize-generated run-level failure index (clean run → failures: [])
  tests/go-to-https-ltqa-domsetu-vercel-app-swit-d997f90e/
    test.md                                 # L0 — the DEFINITION: kane's authored spec. OPAQUE — referenced + hashed, never parsed
    result.yaml                             # L0 — structured per-step outcomes (evidence 0.1): 27 steps, status passed
    logs/                                   # L1 — execution logs, declared in meta.yaml
      meta.yaml
      tui.log                               #      the TUI trace (sanitized)
      0-run.log  runner-stderr.log          #      runner logs
      0-actions.ndjson  0-console.ndjson    #      per-turn action + console streams
      0-network.har                         #      real network capture — 110 requests (format: har)
    steps/<ordinal>-<id>/                   # L1 — one folder per executed step, matched to a result.yaml step
      step.json                             #      kane's per-step record (opaque to the format)
      screenshot.jpg                        #      per-step frame the viewer renders (advisory — a missing frame never fails the pack)
```

Everything here is the minimal **L0** core (`run.yaml` + `tests/<id>/{test.md,
result.yaml}`) plus the additive **L1** artifact layer (logs, per-step screenshots,
a coverage dir, the failure index). It validates at both profiles:

```bash
evidence validate examples/kane-cli/kane-cli.evidence --profile L1   # → ok valid
evidence validate examples/kane-cli/kane-cli.evidence --profile L0   # → ok valid
```

### Who writes what

| Part of the pack | Written by | Notes |
| --- | --- | --- |
| `run.yaml` (identity, `environment.producer`) | **kane** — `pack-writer.ts` `buildRunYaml` | `producer: { name: kane-cli, version: 0.8.3 }` |
| `tests/<id>/result.yaml` (status, steps, environment) | **kane** — `result-builder.ts` `buildResultYaml` | `evidence: "0.1"`, step `kind`s (`navigate`/`select`/`scroll`/`click`/`type`/`wait`) are producer-defined |
| `tests/<id>/test.md` (the definition) | **kane** — the recorder's synthesized spec | Opaque to evidence-cli |
| `steps/…/step.json`, `screenshot.jpg`, `logs/*` | **the v16 runner binary** | Dropped straight into the pack during the run |
| `run.yaml.ended` + `.totals`, `result.yaml` `definition.sha256`, root `failure.yaml` | **`evidence finalize`** | The only fields the format *derives*; the rest is verbatim from the producer |

`test.md`, `step.json`, and the `*.ndjson` / `*.har` / `*.log` files are all
**opaque**: evidence-cli references and (for the definition) hashes them, but never
parses their content. That opacity is why the format is framework-agnostic — swap
`test.md` for a `checkout.spec.ts` and a Jest producer's `result.yaml`, and nothing
else changes.

## produce → seal → serve → view

This is the exact pipeline kane-cli ran for this pack, and the same four steps any
producer follows.

**1. Produce.** kane's writers build the live `<execution_id>.evidence/` directory —
`run.yaml` with `status: running`, then each `tests/<id>/result.yaml` as steps
complete.

**2. Seal.** `finalize()` rolls up `totals`, hashes each definition into
`definition.sha256`, generates the root `failure.yaml` index, stamps
`status: finalized` + `ended`, and atomically seals the directory into a flat,
range-addressable `.evidence` zip.

```bash
# The committed pack here is already in the finalized state finalize produces.
# To get a loadable sealed zip, finalize a copy (finalize replaces the dir in place):
cp -R examples/kane-cli/kane-cli.evidence /tmp/kane-checkout.evidence
evidence finalize /tmp/kane-checkout.evidence       # → /tmp/kane-checkout.evidence (sealed zip)
```

Finalize is deterministic: on this pack it re-derives the identical
`definition.sha256`, the same `totals`, and the same failure index — the committed
directory *is* its output.

**3. Serve.** The sealed zip is served over HTTP with **Range** support, so the
viewer streams just the bytes it needs (one `result.yaml`, one screenshot) without
downloading the whole pack — evidence-cli's `RemoteZipContainer` reads it. kane-cli
does this from a hardened loopback server bound to `127.0.0.1`, token-gated and
origin-allow-listed (`kane-cli/src/evidence/local-server.ts`), exposed as
`kane-cli evidence serve <pack>`. In this repo you can serve one the same way:

```bash
node local-testing/serve.cjs        # Range-capable HTTP server for a sealed .evidence
```

**4. View.** Open the pack in the viewer — either point it at the served URL or drop
the sealed file straight in. Both are covered in **[The viewer](#the-viewer)** below;
the served handoff is one query param, `${viewer}/?pack=<url>`.

## The viewer

The viewer is a hosted single-page app (`https://evidence.lambdatest.com`); it is
**not** in this repo — it ships from `lt-web-platform`. It is a *pure format
consumer*: it reads the sealed pack layout and the JSON Schemas under
`src/schemas/0.1/`, and knows nothing about kane-cli or any other producer. Hand it a
conformant pack and it renders the run — `run.yaml` for the header and totals, each
`result.yaml` for the step list, `logs/` for the Logs tab, and each
`steps/<ordinal>-<id>/screenshot.<ext>` for the frame on a step.

There are two ways to get a pack into it — and both work *because* a sealed
`.evidence` is one flat, **range-addressable** zip (decision
[0041](../../design/decisions/0041-range-addressable-packs.md)).

**1. Point it at a byte-addressable URL.** The universality contract is one query
parameter (`kane-cli/src/evidence/viewer-url.ts`):

```
${viewerBase}/?pack=${encodeURIComponent(packUrl)}
```

If `packUrl` is served by anything that honours **HTTP Range** — a blob store (S3,
Azure Blob, GCS), a CDN, or kane-cli's own loopback server — the viewer never
downloads the whole pack. A zip keeps its **central directory at the tail**, so the
viewer fetches just that (the entry manifest: names, offsets, sizes), then issues a
ranged GET for only the bytes it needs: `run.yaml` + each `result.yaml` to draw the
run, one `screenshot.<ext>` when you click a step. An L1 pack can be hundreds of MB;
opening it touches kilobytes. `finalize` guarantees this by keeping the archive flat
and STOREing already-compressed artifacts (images, video) as contiguous byte spans —
so the viewer can even HTTP-range *into* a video to scrub, not fetch-whole-then-play.
That is exactly what evidence-cli's `RemoteZipContainer` (`src/pack/remote.ts`) does;
the viewer is the same idea in the browser.

**2. Drop a local `.evidence` file.** Have a sealed pack on disk? Drag it onto the
viewer. Because the pack is self-contained and the browser's File API gives the same
random access (`Blob.slice` is the local analog of an HTTP range), the viewer reads
the central directory and slices out entries on demand — no server, no upload, no
network round-trip. The same SPA renders a dropped file and a `?pack=<url>`
identically.

Either way the viewer only ever sees a conformant pack + the schemas — never the
producer. Point it at this kane-cli pack, or a Playwright pack, and it renders both
the same. That is the whole claim this example exists to make concrete.

## Reuse this as a producer template

To make a new framework loadable in the same viewer, emit this shape:

1. `run.yaml` — `evidence: "0.1"`, a `run_id`, `title`, `started`, and
   `environment.producer.name` set to your tool.
2. `tests/<id>/<definition>` — your framework's own artifact, whatever it is.
3. `tests/<id>/result.yaml` — `evidence: "0.1"`, `test` (== the dir name), `status`,
   and `steps[]` (each with `id`, a unique increasing `ordinal`, `status`).
4. Run `evidence finalize` to seal — it fills in totals, hashes, and the index.
5. Serve the sealed zip with Range support and open `${viewer}/?pack=<url>`.

Add the L1 layer (`logs/`, `steps/…/screenshot.<ext>`, `coverage/`) when you have it;
it is purely additive. The schemas under `src/schemas/0.1/` are the single source of
truth for exactly what is required at each profile.

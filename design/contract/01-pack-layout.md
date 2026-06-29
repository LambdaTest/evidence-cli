---
title: Pack layout
order: 1
profile: L0
---

# Pack layout (L0)

An **evidence pack** is the unit of the format. It exists in two forms:

- **Live** — a `<name>.evidence/` **directory**, written while a run is in flight.
- **Sealed** — a `<name>.evidence` **file**: that directory zipped. A plain zip
  with a known extension, like `.ipa` or `.epub`. Transport and seal only — the
  bytes inside are identical to the directory.

The sealed zip is **flat**: its entries are exactly the *contents* of the
`<name>.evidence/` directory — `run.yaml` at the archive root, `tests/…` beside
it, with **no** wrapping `<name>.evidence/` folder. "Top-level `run.yaml`"
therefore means the same thing in both forms (directory root / archive root), so
a reader resolves the anchor and every relative `definition.path` identically.
The pack `<name>` lives only in the file name, never as an internal path segment.
See decision [0028 — zip internal layout](#/decisions).

**One pack = one run.** The top-level `run.yaml` is the **manifest anchor**: a
directory (or zip) is a valid pack if and only if it has a top-level `run.yaml`.

## The L0 tree

```
<name>.evidence/
  run.yaml                 # required — the manifest anchor (run-level)
  summary.md               # optional — auto-generated human TL;DR (never parsed)
  tests/
    <id>/                  # one directory per test; id = a slug or run id
      <definition>         # required, OPAQUE — the framework's own artifact
      result.yaml          # required — structured per-step outcomes
      result.md            # optional — auto-generated render (never parsed)
      summary.md           # optional — auto-generated per-test TL;DR
```

Only three artifacts are **load-bearing** at L0:

| Artifact | Role |
| --- | --- |
| `run.yaml` | Run manifest + anchor. See the [run.yaml schema](#/contract). |
| `tests/<id>/<definition>` | What was tested — **opaque** to evidence-cli; referenced and hashed, never parsed. |
| `tests/<id>/result.yaml` | What happened — structured, parseable per-step outcomes. |

Everything else (`summary.md`, `result.md`, any attachments) is **optional and
additive**: auto-generated *from* the load-bearing data and never required.
evidence-cli never depends on it and never parses opaque extras.

## Framework-agnostic by construction

evidence-cli knows **nothing** about any framework's definition format. The
definition file may be `test.md` (kane), `login.spec.ts` (Playwright), or
anything else. evidence-cli asserts the file exists and records its hash; it
never reads the content. See decision
[0002 — Framework-agnostic](#/decisions) and
[0004 — Definition required but opaque](#/decisions).
